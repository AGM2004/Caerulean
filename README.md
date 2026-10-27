# Caerulean Website

Pre-launch landing page for Caerulean, a marketplace connecting influencers/creators with sponsors. Static HTML/CSS/JS deployed via GitHub Pages.

## Structure

- `index.html` — page markup
- `css/styles.css` — styles
- `js/main.js` — mobile nav toggle, footer year, waitlist form
- `img/` — logo and favicons
- `.nojekyll` — tells GitHub Pages to serve files as-is (no Jekyll processing)

## Local preview

Open `index.html` directly in a browser, or serve it locally:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Waitlist form

The form in `#waitlist` posts JSON to the URL in its `data-endpoint` attribute
(e.g. a [Formspree](https://formspree.io) endpoint like `https://formspree.io/f/xxxxxxx`).
While `data-endpoint` is empty, submitting opens a prefilled email to `hello@caerulean.co` instead.

## Deployment

Served via GitHub Pages from the `main` branch. Push to `main` to update the live site.

## TODO

- [ ] Set the waitlist form's `data-endpoint` to a real form service URL
- [ ] Swap `hello@caerulean.co` for the real contact address
