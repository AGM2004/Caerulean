document.getElementById("year").textContent = new Date().getFullYear();

const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");

navToggle.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

navLinks.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

// Waitlist form
const form = document.getElementById("waitlistForm");
const formStatus = document.getElementById("formStatus");
const linkLabel = form.querySelector("[data-creator-label]");
const linkInput = form.querySelector('input[name="link"]');

function setRole(role) {
  form.querySelector(`input[name="role"][value="${role}"]`).checked = true;
  linkLabel.textContent = linkLabel.dataset[`${role}Label`];
  linkInput.placeholder = linkInput.dataset[`${role}Placeholder`];
}

form.querySelectorAll('input[name="role"]').forEach((input) => {
  input.addEventListener("change", () => setRole(input.value));
});

// "I'm a creator" / "I'm a brand" links preselect the role in the form
document.querySelectorAll('a[data-role][href="#waitlist"]').forEach((link) => {
  link.addEventListener("click", () => setRole(link.dataset.role));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const endpoint = form.dataset.endpoint;

  // No form endpoint configured yet: fall back to a prefilled email
  if (!endpoint) {
    const body = `Role: ${data.role}\nName: ${data.name}\nEmail: ${data.email}\nLink: ${data.link}`;
    window.location.href = `mailto:hello@caerulean.co?subject=${encodeURIComponent("Caerulean waitlist")}&body=${encodeURIComponent(body)}`;
    return;
  }

  formStatus.className = "form-status";
  formStatus.textContent = "Sending…";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(res.statusText);
    form.reset();
    setRole("creator");
    formStatus.classList.add("success");
    formStatus.textContent = "You're on the list! We'll be in touch soon.";
  } catch {
    formStatus.classList.add("error");
    formStatus.textContent = "Something went wrong. Please try again or email us.";
  }
});
