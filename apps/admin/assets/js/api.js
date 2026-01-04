export const api = {
  base: "http://localhost:8080",

  bucketName() {
    // purely informational in UI; real value is server env
    return "samplebucket1";
  },

  async login(dealerId, pin) {
    return this._json("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ dealerId, pin })
    });
  },

  async listVehicles(dealerId) {
    return this._json(`/api/dealers/${dealerId}/vehicles`, { method: "GET" }, true);
  },

  async createVehicle(dealerId, payload, token) {
    return this._json(`/api/dealers/${dealerId}/vehicles`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
  },

  async updateVehicle(dealerId, vehicleId, patch, token) {
    return this._json(`/api/dealers/${dealerId}/vehicles/${vehicleId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch)
    });
  },

  async signUpload(dealerId, vehicleId, payload, token) {
    return this._json(`/api/dealers/${dealerId}/vehicles/${vehicleId}/uploads/sign`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
  },

  async publicVehicles(dealerId = "") {
    const q = dealerId ? `?dealerId=${encodeURIComponent(dealerId)}` : "";
    return this._json(`/api/public/vehicles${q}`, { method: "GET" }, true);
  },

  async _json(path, init = {}, noAuth = false) {
    const headers = {
      "Content-Type": "application/json",
      ...(init.headers || {})
    };
    const res = await fetch(this.base + path, { ...init, headers });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Request failed");
    return data;
  }
};
