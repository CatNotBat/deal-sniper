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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers: fall back to a hidden textarea and execCommand.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

const copyButton = document.getElementById("copy-bookmarklet");
const copyStatus = document.getElementById("copy-status");
copyButton?.addEventListener("click", async () => {
  const ok = await copyText(bookmarkletHref);
  if (copyStatus) {
    copyStatus.textContent = ok
      ? "Copied. Now paste it as the address of a bookmark."
      : "Couldn't copy automatically. Long-press the Deal Sniper button and choose Copy Link.";
  }
});
