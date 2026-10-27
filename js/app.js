import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);

// Builds an element; children may be nodes or strings (always inserted as text,
// so user-supplied content is never parsed as HTML).
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

const VIEWS = ["setup", "signin", "profile", "discover", "requests", "messages"];

const state = {
  me: null, // my profile row
  user: null, // auth user
  profiles: new Map(), // id -> profile (everyone except me)
  connections: [], // rows where I'm requester or addressee
  latest: new Map(), // connection id -> most recent message
  activeConnectionId: null,
  roleFilter: "all",
  search: "",
};

let supabase;
let channel;

// ---------------------------------------------------------------- boot

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  showView("setup");
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let sessionQueue = Promise.resolve();
  supabase.auth.onAuthStateChange((event, session) => {
    // Defer so Supabase calls made in the handler don't deadlock the auth lock,
    // and handle events one at a time so they can't race each other.
    setTimeout(() => {
      sessionQueue = sessionQueue.then(() => handleSession(session)).catch((e) => toast(e.message));
    }, 0);
  });
  bindUi();
}

async function handleSession(session) {
  const userId = session?.user?.id ?? null;
  if (userId === state.user?.id && state.me) return; // token refresh etc.

  if (!session) {
    teardown();
    showView("signin");
    return;
  }

  state.user = session.user;
  const { data: me, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) return toast(error.message);

  if (!me) {
    fillProfileForm(null);
    showView("profile");
    return;
  }

  state.me = me;
  await loadAll();
  subscribe();
  route();
}

function teardown() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
  Object.assign(state, {
    me: null,
    user: null,
    profiles: new Map(),
    connections: [],
    latest: new Map(),
    activeConnectionId: null,
  });
  $("appNav").hidden = true;
}

// ---------------------------------------------------------------- data

async function loadAll() {
  await Promise.all([loadProfiles(), loadConnections()]);
  await loadLatestMessages();
  renderNav();
}

async function loadProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .neq("id", state.me.id)
    .order("created_at", { ascending: false });
  if (error) return toast(error.message);
  state.profiles = new Map(data.map((p) => [p.id, p]));
}

async function loadConnections() {
  const { data, error } = await supabase.from("connections").select("*");
  if (error) return toast(error.message);
  state.connections = data;
}

async function loadLatestMessages() {
  const ids = accepted().map((c) => c.id);
  state.latest = new Map();
  if (!ids.length) return;
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .in("connection_id", ids)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return toast(error.message);
  for (const msg of data) {
    if (!state.latest.has(msg.connection_id)) state.latest.set(msg.connection_id, msg);
  }
}

async function ensureProfile(id) {
  if (state.profiles.has(id)) return;
  const { data } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (data) state.profiles.set(id, data);
}

const otherId = (c) => (c.requester_id === state.me.id ? c.addressee_id : c.requester_id);
const accepted = () => state.connections.filter((c) => c.status === "accepted");
const incoming = () =>
  state.connections.filter((c) => c.status === "pending" && c.addressee_id === state.me.id);
const outgoing = () =>
  state.connections.filter((c) => c.status === "pending" && c.requester_id === state.me.id);
const connectionWith = (id) => state.connections.find((c) => otherId(c) === id);

// ---------------------------------------------------------------- realtime

function subscribe() {
  if (channel) supabase.removeChannel(channel);
  channel = supabase
    .channel("inbox")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: msg }) =>
      onNewMessage(msg)
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "connections" }, async () => {
      await loadConnections();
      await Promise.all(state.connections.map((c) => ensureProfile(otherId(c))));
      await loadLatestMessages();
      renderNav();
      rerenderCurrent();
    })
    .subscribe();
}

function onNewMessage(msg) {
  if (!state.connections.some((c) => c.id === msg.connection_id)) return;
  state.latest.set(msg.connection_id, msg);
  if (msg.connection_id === state.activeConnectionId && currentView() === "messages") {
    appendMessage(msg);
    markRead(msg.connection_id);
  }
  renderNav();
  if (currentView() === "messages") renderConvoList();
}

// ---------------------------------------------------------------- unread (per browser)

function readMap() {
  try {
    return JSON.parse(localStorage.getItem(`caerulean-read-${state.me.id}`)) || {};
  } catch {
    return {};
  }
}

function markRead(connectionId) {
  const map = readMap();
  map[connectionId] = new Date().toISOString();
  try {
    localStorage.setItem(`caerulean-read-${state.me.id}`, JSON.stringify(map));
  } catch {
    // Storage unavailable: unread dots just won't persist.
  }
}

function isUnread(connectionId) {
  const msg = state.latest.get(connectionId);
  if (!msg || msg.sender_id === state.me.id) return false;
  const lastRead = readMap()[connectionId];
  return !lastRead || msg.created_at > lastRead;
}

// ---------------------------------------------------------------- routing

function currentView() {
  return location.hash.slice(1).split("/")[0] || "discover";
}

function route() {
  if (!state.me) return;
  const [view, param] = location.hash.slice(1).split("/");
  switch (view) {
    case "profile":
      fillProfileForm(state.me);
      showView("profile");
      break;
    case "requests":
      showView("requests");
      renderRequests();
      break;
    case "messages":
      state.activeConnectionId = param ? Number(param) : null;
      showView("messages");
      renderMessages();
      break;
    default:
      showView("discover");
      renderDiscover();
  }
}

function rerenderCurrent() {
  const view = currentView();
  if (view === "discover") renderDiscover();
  else if (view === "requests") renderRequests();
  else if (view === "messages") {
    // The open conversation may have just been removed.
    if (state.activeConnectionId && !accepted().some((c) => c.id === state.activeConnectionId)) {
      location.hash = "messages";
    } else {
      renderConvoList();
    }
  }
}

function showView(name) {
  $("loading").hidden = true;
  for (const view of VIEWS) $(`view-${view}`).hidden = view !== name;
  document.querySelectorAll("#appNav a[data-view]").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === name);
  });
}

// ---------------------------------------------------------------- shared UI

function avatar(profile, size = "") {
  const cls = `avatar ${size}`.trim();
  if (profile?.avatar_url) {
    return el("img", { class: cls, src: profile.avatar_url, alt: "", referrerpolicy: "no-referrer" });
  }
  const initials = (profile?.display_name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return el("span", { class: cls, "aria-hidden": "true" }, initials);
}

function roleTag(profile) {
  return el("span", { class: `role-tag role-${profile.role}` }, profile.role === "brand" ? "Brand" : "Creator");
}

function personSummary(profile) {
  return el(
    "div",
    { class: "person-summary" },
    avatar(profile),
    el(
      "div",
      {},
      el("div", { class: "person-name" }, profile.display_name, " ", roleTag(profile)),
      el("div", { class: "person-meta" }, [profile.handle, profile.niche].filter(Boolean).join(" · "))
    )
  );
}

function button(label, onclick, cls = "btn btn-small btn-primary") {
  return el("button", { type: "button", class: cls, onclick }, label);
}

function emptyState(text) {
  return el("p", { class: "empty" }, text);
}

let toastTimer;
function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 4000);
}

function renderNav() {
  $("appNav").hidden = false;
  $("navMe").replaceChildren(avatar(state.me, "avatar-sm"));

  const requests = incoming().length;
  $("requestsBadge").hidden = !requests;
  $("requestsBadge").textContent = requests;

  const unread = accepted().filter((c) => isUnread(c.id)).length;
  $("messagesBadge").hidden = !unread;
  $("messagesBadge").textContent = unread;
}

// ---------------------------------------------------------------- actions

async function sendRequest(profile) {
  const { error } = await supabase
    .from("connections")
    .insert({ requester_id: state.me.id, addressee_id: profile.id });
  if (error) return toast(error.message);
  toast(`Request sent to ${profile.display_name}`);
  await loadConnections();
  rerenderCurrent();
}

async function acceptRequest(connection) {
  const { error } = await supabase
    .from("connections")
    .update({ status: "accepted" })
    .eq("id", connection.id);
  if (error) return toast(error.message);
  await loadConnections();
  renderNav();
  rerenderCurrent();
}

async function removeConnection(connection, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  const { error } = await supabase.from("connections").delete().eq("id", connection.id);
  if (error) return toast(error.message);
  await loadConnections();
  renderNav();
  rerenderCurrent();
}

function connectionAction(profile) {
  const c = connectionWith(profile.id);
  if (!c) return button("Connect", () => sendRequest(profile));
  if (c.status === "accepted") {
    return el("a", { class: "btn btn-small btn-primary", href: `#messages/${c.id}` }, "Message");
  }
  if (c.addressee_id === state.me.id) return button("Accept request", () => acceptRequest(c));
  return button("Requested", () => removeConnection(c, `Cancel your request to ${profile.display_name}?`), "btn btn-small btn-ghost");
}

// ---------------------------------------------------------------- discover

function renderDiscover() {
  const query = state.search.trim().toLowerCase();
  const people = [...state.profiles.values()].filter((p) => {
    if (state.roleFilter !== "all" && p.role !== state.roleFilter) return false;
    if (!query) return true;
    return [p.display_name, p.handle, p.niche, p.bio].some((v) => v?.toLowerCase().includes(query));
  });

  const grid = $("peopleGrid");
  if (!people.length) {
    grid.replaceChildren(
      emptyState(state.profiles.size ? "No one matches that search yet." : "You're one of the first here. Check back soon as more creators and brands join.")
    );
    return;
  }
  grid.replaceChildren(
    ...people.map((p) =>
      el(
        "article",
        { class: "person-card" },
        personSummary(p),
        p.bio && el("p", { class: "person-bio" }, p.bio),
        el("div", { class: "person-actions" }, connectionAction(p))
      )
    )
  );
}

// ---------------------------------------------------------------- requests

function renderRequests() {
  const row = (c, ...actions) => {
    const p = state.profiles.get(otherId(c));
    if (!p) return null;
    return el("div", { class: "person-row" }, personSummary(p), el("div", { class: "person-actions" }, actions));
  };

  const fill = (id, items, empty) => {
    const rows = items.filter(Boolean);
    $(id).replaceChildren(...(rows.length ? rows : [emptyState(empty)]));
  };

  fill(
    "incomingList",
    incoming().map((c) =>
      row(c, button("Accept", () => acceptRequest(c)), button("Decline", () => removeConnection(c), "btn btn-small btn-ghost"))
    ),
    "No pending requests."
  );
  fill(
    "outgoingList",
    outgoing().map((c) => row(c, button("Cancel", () => removeConnection(c), "btn btn-small btn-ghost"))),
    "You haven't sent any requests that are still pending."
  );
  fill(
    "connectedList",
    accepted().map((c) => {
      const name = state.profiles.get(otherId(c))?.display_name;
      return row(
        c,
        el("a", { class: "btn btn-small btn-primary", href: `#messages/${c.id}` }, "Message"),
        button("Remove", () => removeConnection(c, `Remove ${name}? Your conversation will be deleted for both of you.`), "btn btn-small btn-ghost")
      );
    }),
    "No connections yet. Find people on Discover."
  );
}

// ---------------------------------------------------------------- messages

function sortedConversations() {
  return accepted().sort((a, b) => {
    const at = state.latest.get(a.id)?.created_at || a.created_at;
    const bt = state.latest.get(b.id)?.created_at || b.created_at;
    return bt.localeCompare(at);
  });
}

function renderConvoList() {
  const convos = sortedConversations();
  const list = $("convoList");
  if (!convos.length) {
    list.replaceChildren(emptyState("No conversations yet."));
    return;
  }
  list.replaceChildren(
    ...convos.map((c) => {
      const p = state.profiles.get(otherId(c));
      if (!p) return "";
      const last = state.latest.get(c.id);
      const preview = last ? (last.sender_id === state.me.id ? "You: " : "") + last.body : "Say hello 👋";
      return el(
        "a",
        {
          class: `convo ${c.id === state.activeConnectionId ? "active" : ""} ${isUnread(c.id) ? "unread" : ""}`,
          href: `#messages/${c.id}`,
        },
        avatar(p),
        el(
          "div",
          { class: "convo-text" },
          el("div", { class: "convo-top" }, el("span", { class: "person-name" }, p.display_name), last && el("time", {}, formatTime(last.created_at))),
          el("div", { class: "convo-preview" }, preview)
        )
      );
    })
  );
}

async function renderMessages() {
  const view = $("view-messages");
  const conn = accepted().find((c) => c.id === state.activeConnectionId);
  view.classList.toggle("has-thread", Boolean(conn));
  $("threadEmpty").hidden = Boolean(conn);
  $("threadInner").hidden = !conn;
  renderConvoList();
  if (!conn) return;

  const p = state.profiles.get(otherId(conn));
  $("threadPerson").replaceChildren(personSummary(p));
  const box = $("threadMessages");
  box.replaceChildren(el("p", { class: "empty" }, "Loading…"));

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("connection_id", conn.id)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) return toast(error.message);
  if (state.activeConnectionId !== conn.id) return; // switched away while loading

  box.replaceChildren();
  if (!data.length) box.append(el("p", { class: "empty" }, `You're connected with ${p.display_name}. Start the conversation.`));
  data.forEach(appendMessage);
  markRead(conn.id);
  renderNav();
  renderConvoList();
  $("composer").body.focus();
}

function appendMessage(msg) {
  const box = $("threadMessages");
  if (box.querySelector(`[data-id="${msg.id}"]`)) return;
  box.querySelector(".empty")?.remove();
  const mine = msg.sender_id === state.me.id;
  box.append(
    el(
      "div",
      { class: `bubble ${mine ? "mine" : "theirs"}`, dataset: { id: msg.id } },
      el("p", {}, msg.body),
      el("time", { datetime: msg.created_at }, formatTime(msg.created_at))
    )
  );
  box.scrollTop = box.scrollHeight;
}

function formatTime(iso) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

async function sendMessage(event) {
  event.preventDefault();
  const form = event.target;
  const body = form.body.value.trim();
  if (!body || !state.activeConnectionId) return;
  form.body.value = "";
  autosize(form.body);

  const { data, error } = await supabase
    .from("messages")
    .insert({ connection_id: state.activeConnectionId, body })
    .select()
    .single();
  if (error) {
    form.body.value = body;
    return toast(error.message);
  }
  onNewMessage(data); // realtime will echo it too; appendMessage skips duplicates
}

function autosize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}

// ---------------------------------------------------------------- profile

function setFormRole(role) {
  const form = $("profileForm");
  form.querySelector(`input[name="role"][value="${role}"]`).checked = true;
  form.querySelectorAll("[data-creator-label]").forEach((n) => (n.textContent = n.dataset[`${role}Label`]));
  form.querySelectorAll("[data-creator-placeholder]").forEach((n) => (n.placeholder = n.dataset[`${role}Placeholder`]));
}

function fillProfileForm(profile) {
  const form = $("profileForm");
  const meta = state.user?.user_metadata || {};
  const isNew = !profile;
  $("profileTitle").textContent = isNew ? "Set up your profile" : "Your profile";
  $("profileIntro").hidden = !isNew;
  $("signOut").hidden = false;
  form.display_name.value = profile?.display_name ?? meta.full_name ?? meta.name ?? "";
  form.handle.value = profile?.handle ?? "";
  form.niche.value = profile?.niche ?? "";
  form.bio.value = profile?.bio ?? "";
  setFormRole(profile?.role ?? "creator");
  $("profileStatus").textContent = "";
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target;
  const status = $("profileStatus");
  const meta = state.user.user_metadata || {};
  const row = {
    id: state.user.id,
    role: form.role.value,
    display_name: form.display_name.value.trim(),
    handle: form.handle.value.trim() || null,
    niche: form.niche.value.trim() || null,
    bio: form.bio.value.trim() || null,
    avatar_url: state.me?.avatar_url ?? meta.avatar_url ?? meta.picture ?? null,
  };

  status.className = "form-status";
  status.textContent = "Saving…";
  const { data, error } = await supabase.from("profiles").upsert(row).select().single();
  if (error) {
    status.className = "form-status error";
    status.textContent = error.message;
    return;
  }

  const isNew = !state.me;
  state.me = data;
  if (isNew) {
    await loadAll();
    subscribe();
    location.hash = "discover";
    route();
  } else {
    renderNav();
    status.className = "form-status success";
    status.textContent = "Saved.";
  }
}

// ---------------------------------------------------------------- wiring

function bindUi() {
  $("googleSignIn").addEventListener("click", async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) $("signinStatus").textContent = error.message;
  });

  $("signOut").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.hash = "";
  });

  $("profileForm").addEventListener("submit", saveProfile);
  $("profileForm")
    .querySelectorAll('input[name="role"]')
    .forEach((input) => input.addEventListener("change", () => setFormRole(input.value)));

  $("search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderDiscover();
  });

  $("roleFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-role]");
    if (!btn) return;
    state.roleFilter = btn.dataset.role;
    $("roleFilter").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    renderDiscover();
  });

  const composer = $("composer");
  composer.addEventListener("submit", sendMessage);
  composer.body.addEventListener("input", () => autosize(composer.body));
  composer.body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  window.addEventListener("hashchange", route);
}
