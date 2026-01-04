export function toast(message) {
  const t = document.getElementById("toast");
  const msg = document.getElementById("toastMsg");
  msg.textContent = message || "";
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2600);
}
