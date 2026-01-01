interface SessionInfo {
  name: string;
  sub: string;
}

interface FlagStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  service: string;
}

type FlagsByService = Record<string, FlagStatus[]>;

interface SessionResponse {
  session: SessionInfo | null;
  forbidden: boolean;
}

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch("/api/session");
  if (res.status === 401) return { session: null, forbidden: false };
  if (res.status === 403) return { session: null, forbidden: true };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch session: ${res.status} ${text}`);
  }
  return { session: await res.json(), forbidden: false };
}

async function fetchFlags(): Promise<FlagsByService> {
  const res = await fetch("/api/flags");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch flags: ${res.status} ${text}`);
  }
  return res.json();
}

async function toggleFlag(flagId: string, enabled: boolean): Promise<void> {
  const res = await fetch(`/api/flags/${flagId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error("Failed to update flag");
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderDashboard(session: SessionInfo, flagsByService: FlagsByService): string {
  const services = Object.entries(flagsByService);

  const servicesSections = services
    .map(([serviceId, flags]) => {
      const flagCards = flags
        .map(
          (flag) => `
        <div class="flag-card">
          <div class="flag-info">
            <h3>${escapeHtml(flag.name)}</h3>
            <p>${escapeHtml(flag.description)}</p>
          </div>
          <label class="toggle">
            <input 
              type="checkbox" 
              ${flag.enabled ? "checked" : ""} 
              data-flag="${escapeHtml(flag.id)}"
            >
            <span class="toggle-slider"></span>
          </label>
        </div>
      `
        )
        .join("");

      return `
        <section class="service-section">
          <h2 class="service-title">${escapeHtml(serviceId)}</h2>
          ${flagCards}
        </section>
      `;
    })
    .join("");

  return `
    <div class="container">
      <header>
        <h1>Control Panel</h1>
        <div class="user-info">
          <span class="user-name">${escapeHtml(session.name)}</span>
          <button type="button" class="logout-btn" id="logout-btn">Logout</button>
        </div>
      </header>
      
      <main>
        ${servicesSections || '<div class="empty-state">No services configured</div>'}
      </main>
    </div>
  `;
}

function renderLoading(): string {
  return '<div class="loading">Loading...</div>';
}

function renderError(message: string): string {
  return `<div class="container"><div class="error">${escapeHtml(message)}</div></div>`;
}

async function init() {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = renderLoading();

  try {
    const { session, forbidden } = await fetchSession();
    if (!session) {
      if (forbidden) {
        app.innerHTML = renderError("Access denied: you don't have permission to access the control panel.");
        return;
      }
      window.location.href = "/auth/login";
      return;
    }

    const flags = await fetchFlags();
    app.innerHTML = renderDashboard(session, flags);

    document.getElementById("logout-btn")?.addEventListener("click", async () => {
      await fetch("/auth/logout", { method: "POST" });
      window.location.href = "/auth/login";
    });

    app.querySelectorAll<HTMLInputElement>("input[data-flag]").forEach((input) => {
      input.addEventListener("change", async () => {
        const flagId = input.dataset.flag;
        if (!flagId) return;

        input.disabled = true;
        try {
          await toggleFlag(flagId, input.checked);
        } catch (err) {
          input.checked = !input.checked;
          alert("Failed to update flag");
        } finally {
          input.disabled = false;
        }
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    app.innerHTML = renderError(message);
    console.error(err);
  }
}

init();
