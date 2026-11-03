declare const __BOOKMARKLET__: string;

const appUrl = new URL("app.html", location.href).href;
const bookmarkletHref =
  "javascript:" + encodeURIComponent(__BOOKMARKLET__.replaceAll("__APP_URL__", appUrl));

const anchor = document.getElementById("bookmarklet");
if (anchor) {
  anchor.setAttribute("href", bookmarkletHref);
  anchor.addEventListener("click", (ev) => {
    ev.preventDefault();
    const hint = document.getElementById("install-hint");
    if (hint) {
      hint.textContent =
        "Drag the button to your bookmarks bar, then click it on a Marketplace search.";
    }
  });
}
