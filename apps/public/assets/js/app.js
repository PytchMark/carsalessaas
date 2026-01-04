const API_BASE = "http://localhost:8080";

const el = (id)=>document.getElementById(id);

let vehicles = [];

function applyFilter() {
  const q = el("q").value.trim().toLowerCase();
  const filtered = vehicles.filter(v => {
    const hay = `${v.title||""} ${v.make||""} ${v.model||""}`.toLowerCase();
    return !q || hay.includes(q);
  });
  render(filtered);
}

function render(list) {
  const grid = el("grid");
  grid.innerHTML = "";
  el("empty").style.display = list.length ? "none" : "block";

  list.forEach(v => {
    const card = document.createElement("div");
    card.className = "cardItem";
    const imgSrc = (v.media?.images?.[0]) || "";
    card.innerHTML = `
      <img src="${imgSrc || "https://via.placeholder.com/800x500?text=Vehicle"}" alt="">
      <div class="cardBody">
        <div style="font-weight:650">${v.title || "Vehicle"}</div>
        <div class="muted">${v.make||""} ${v.model||""} · ${v.year||""}</div>
        <div class="muted">JMD ${Number(v.price||0).toLocaleString()}</div>
      </div>
    `;
    card.addEventListener("click", ()=>openModal(v));
    grid.appendChild(card);
  });
}

function openModal(v){
  el("modalBackdrop").classList.remove("hidden");
  el("mTitle").textContent = v.title || "Vehicle";
  el("mMeta").textContent = `${v.make||""} ${v.model||""} · ${v.year||""} · JMD ${Number(v.price||0).toLocaleString()}`;
  el("mNotes").textContent = v.notes || "";
  el("mImg").src = (v.media?.images?.[0]) || "https://via.placeholder.com/1200x700?text=Vehicle";
}

function closeModal(){
  el("modalBackdrop").classList.add("hidden");
}

async function load() {
  const dealerId = el("dealerId").value.trim();
  const url = dealerId
    ? `${API_BASE}/api/public/vehicles?dealerId=${encodeURIComponent(dealerId)}`
    : `${API_BASE}/api/public/vehicles`;

  const res = await fetch(url);
  const data = await res.json();
  vehicles = data.vehicles || [];
  applyFilter();
}

function wire(){
  el("loadBtn").addEventListener("click", load);
  el("applyBtn").addEventListener("click", applyFilter);
  el("q").addEventListener("keydown", (e)=>{ if(e.key==="Enter") applyFilter(); });

  el("mClose").addEventListener("click", closeModal);
  el("modalBackdrop").addEventListener("click", (e)=>{ if(e.target.id==="modalBackdrop") closeModal(); });

  load();
}
wire();
