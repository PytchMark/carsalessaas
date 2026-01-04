import { api } from "./api.js";
import { state } from "./state.js";
import { toast } from "./toast.js";

const el = (id) => document.getElementById(id);

let editingVehicleId = null;

function showLogin() {
  el("loginView").classList.remove("hidden");
  el("dashView").classList.add("hidden");
}
function showDash() {
  el("loginView").classList.add("hidden");
  el("dashView").classList.remove("hidden");
}

function setLoginStatus(msg, isErr=false){
  el("loginStatus").textContent = msg || "";
  el("loginStatus").style.color = isErr ? "#fecaca" : "";
}

function setTableStatus(msg){
  el("tableStatus").textContent = msg || "Ready.";
}

function openModal(vehicle = null){
  el("modalBackdrop").classList.remove("hidden");
  el("modalStatus").textContent = "";
  el("uploadStatus").textContent = "";
  editingVehicleId = vehicle?.vehicleId || null;

  el("modalTitle").textContent = editingVehicleId ? "Edit vehicle" : "New vehicle";
  el("vTitle").value = vehicle?.title || "";
  el("vMake").value = vehicle?.make || "";
  el("vModel").value = vehicle?.model || "";
  el("vYear").value = vehicle?.year ?? "";
  el("vPrice").value = vehicle?.price ?? "";
  el("vStatus").value = vehicle?.status || "Draft";
  el("vNotes").value = vehicle?.notes || "";
  el("fileInput").value = "";
}

function closeModal(){
  el("modalBackdrop").classList.add("hidden");
  editingVehicleId = null;
}

function applyFilters(list){
  const q = el("search").value.trim().toLowerCase();
  const status = el("statusFilter").value.trim().toLowerCase();

  return (list || []).filter(v => {
    const hay = `${v.title||""} ${v.make||""} ${v.model||""}`.toLowerCase();
    const okQ = !q || hay.includes(q);
    const okS = !status || String(v.status||"").toLowerCase() === status;
    return okQ && okS;
  });
}

function updateKpis(vehicles){
  const total = vehicles.length;
  const pub = vehicles.filter(v => String(v.status||"").toLowerCase()==="published").length;
  const draft = vehicles.filter(v => String(v.status||"").toLowerCase()==="draft").length;
  el("kpiTotal").textContent = total;
  el("kpiPub").textContent = pub;
  el("kpiDraft").textContent = draft;
}

function money(n){
  const x = Number(n||0);
  return x.toLocaleString();
}

function renderTable(vehicles){
  const tbody = el("vehiclesTbody");
  tbody.innerHTML = "";

  if (!vehicles.length){
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.style.padding = "16px";
    td.className = "muted";
    td.textContent = "No vehicles match filters.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  vehicles.forEach(v => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => openModal(v));

    const td1 = document.createElement("td");
    td1.innerHTML = `<div style="font-weight:650">${v.title || "Untitled"}</div>
                     <div class="muted">${v.vehicleId} · ${v.make||""} ${v.model||""}</div>`;
    const td2 = document.createElement("td");
    td2.textContent = money(v.price);
    const td3 = document.createElement("td");
    td3.textContent = v.status || "Draft";
    const td4 = document.createElement("td");
    td4.textContent = new Date(v.updatedAt || v.createdAt || Date.now()).toLocaleString();

    tr.append(td1, td2, td3, td4);
    tbody.appendChild(tr);
  });
}

async function loadVehicles(){
  setTableStatus("Loading…");
  const { vehicles } = await api.listVehicles(state.dealerId);
  state.vehicles = vehicles || [];
  const filtered = applyFilters(state.vehicles);
  updateKpis(filtered);
  renderTable(filtered);
  setTableStatus("Ready.");
}

async function handleLogin(){
  const dealerId = el("dealerId").value.trim();
  const pin = el("pin").value.trim();
  if (!dealerId || !pin) return setLoginStatus("Enter dealerId + PIN", true);

  setLoginStatus("Signing in…");
  try {
    const out = await api.login(dealerId, pin);
    state.token = out.token;
    state.dealerId = out.dealer.dealerId;
    state.dealerName = out.dealer.name;

    el("dealerName").textContent = state.dealerName;
    el("dealerMeta").textContent = `dealerId: ${state.dealerId} · bucket: ${api.bucketName()}`;

    showDash();
    await loadVehicles();
    toast("Signed in");
  } catch (e) {
    setLoginStatus(e?.message || "Login failed", true);
  }
}

async function handleSave(){
  const payload = {
    title: el("vTitle").value.trim(),
    make: el("vMake").value.trim(),
    model: el("vModel").value.trim(),
    year: el("vYear").value ? Number(el("vYear").value) : null,
    price: el("vPrice").value ? Number(el("vPrice").value) : 0,
    status: el("vStatus").value.trim(),
    notes: el("vNotes").value
  };

  el("modalStatus").textContent = "Saving…";
  try {
    if (editingVehicleId) {
      await api.updateVehicle(state.dealerId, editingVehicleId, payload, state.token);
      toast("Vehicle updated");
    } else {
      const { vehicle } = await api.createVehicle(state.dealerId, payload, state.token);
      editingVehicleId = vehicle.vehicleId;
      toast("Vehicle created");
    }
    await loadVehicles();
    closeModal();
  } catch (e) {
    el("modalStatus").textContent = e?.message || "Failed to save";
  }
}

async function handleUpload(){
  if (!editingVehicleId) {
    el("uploadStatus").textContent = "Save vehicle first, then upload media.";
    return;
  }
  const files = Array.from(el("fileInput").files || []);
  if (!files.length) return;

  el("uploadStatus").textContent = "Uploading…";

  // get current vehicle record
  const v = state.vehicles.find(x => x.vehicleId === editingVehicleId);
  const media = v?.media || { images: [], videos: [] };

  try {
    for (const f of files) {
      const isVid = f.type.startsWith("video/");
      const type = isVid ? "video" : "image";

      const sig = await api.signUpload(
        state.dealerId,
        editingVehicleId,
        { type, filename: f.name, contentType: f.type },
        state.token
      );

      // upload directly to GCS signed URL
      const putRes = await fetch(sig.url, {
        method: "PUT",
        headers: { "Content-Type": f.type },
        body: f
      });
      if (!putRes.ok) throw new Error("Upload failed: " + f.name);

      if (type === "image") media.images.push(sig.publicUrl);
      else media.videos.push(sig.publicUrl);
    }

    await api.updateVehicle(state.dealerId, editingVehicleId, { media }, state.token);
    toast("Media uploaded");
    el("uploadStatus").textContent = "Done.";
    await loadVehicles();
  } catch (e) {
    el("uploadStatus").textContent = e?.message || "Upload failed";
  }
}

function wire(){
  el("loginBtn").addEventListener("click", handleLogin);
  el("pin").addEventListener("keydown", (e)=>{ if(e.key==="Enter") handleLogin(); });

  el("refreshBtn").addEventListener("click", loadVehicles);
  el("applyFilters").addEventListener("click", () => {
    const filtered = applyFilters(state.vehicles);
    updateKpis(filtered);
    renderTable(filtered);
  });

  el("newVehicleBtn").addEventListener("click", ()=>openModal(null));
  el("modalClose").addEventListener("click", closeModal);
  el("modalCancel").addEventListener("click", closeModal);
  el("modalSave").addEventListener("click", handleSave);
  el("uploadBtn").addEventListener("click", handleUpload);

  el("modalBackdrop").addEventListener("click", (e)=>{
    if (e.target.id === "modalBackdrop") closeModal();
  });

  showLogin();
}

wire();
