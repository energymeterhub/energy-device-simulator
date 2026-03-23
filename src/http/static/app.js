const state = {
  dashboard: null,
  refreshTimer: null,
  switchingProfileId: null
};

const els = {
  refreshButton: document.querySelector('#refresh-button'),
  connectionPill: document.querySelector('#connection-pill'),
  tabLinks: Array.from(document.querySelectorAll('.tab-link')),
  profileGrid: document.querySelector('#profile-grid'),
  deviceIcon: document.querySelector('#device-icon'),
  deviceTitle: document.querySelector('#device-title'),
  deviceDescription: document.querySelector('#device-description'),
  deviceBadges: document.querySelector('#device-badges'),
  deviceNotes: document.querySelector('#device-notes'),
  connectionGrid: document.querySelector('#connection-grid'),
  activityLine: document.querySelector('#activity-line'),
  protocolTitle: document.querySelector('#protocol-title'),
  protocolSummary: document.querySelector('#protocol-summary'),
  protocolSections: document.querySelector('#protocol-sections')
};

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return body;
}

function formatTimestamp(value) {
  if (!value) {
    return 'No requests yet';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function formatTransport(value) {
  if (value === 'modbus-tcp') {
    return 'Modbus TCP';
  }

  if (value === 'shelly-gen1-http') {
    return 'Shelly Gen1 HTTP';
  }

  return value || 'Unknown';
}

function clearElement(element) {
  if (element) {
    element.innerHTML = '';
  }
}

function getIconTone(transport) {
  if (transport === 'modbus-tcp') {
    return 'is-modbus';
  }

  if (transport === 'shelly-gen1-http') {
    return 'is-http';
  }

  return '';
}

function getProtocolIconMarkup(transport) {
  if (transport === 'modbus-tcp') {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/>
        <path d="M8 10H16M8 14H12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M9 3V5M15 3V5M9 19V21M15 19V21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `;
  }

  if (transport === 'shelly-gen1-http') {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 10.5C9.3 7.1 14.7 7.1 18 10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M8.7 13.2C10.5 11.3 13.5 11.3 15.3 13.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <circle cx="12" cy="16.8" r="1.4" fill="currentColor"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3L19 7V17L12 21L5 17V7L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M9 12H15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;
}

function renderDeviceIcon(profile) {
  if (!els.deviceIcon) {
    return;
  }

  const tone = getIconTone(profile?.transport);
  els.deviceIcon.className = tone ? `device-icon ${tone}` : 'device-icon';
  els.deviceIcon.innerHTML = getProtocolIconMarkup(profile?.transport);
}

function setActiveTab(sectionId) {
  els.tabLinks.forEach((link) => {
    const href = link.getAttribute('href') || '';
    link.classList.toggle('is-active', href === `#${sectionId}`);
  });
}

function renderConnectionPill(dashboard) {
  const device = dashboard.device;
  if (!device) {
    els.connectionPill.textContent = 'Offline';
    els.connectionPill.dataset.transport = 'offline';
    return;
  }

  const host = device.host === '0.0.0.0' ? '127.0.0.1' : device.host;
  const port = device.port || device.configuredPort;
  els.connectionPill.dataset.transport = device.transport || '';
  els.connectionPill.textContent = `${formatTransport(device.transport)} · ${host}:${port}`;
}

function renderProfileGrid(dashboard) {
  clearElement(els.profileGrid);
  const activeProfileId = dashboard.device?.profileId || null;

  (dashboard.profiles || []).forEach((profile) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-card';
    button.dataset.profileId = profile.id;
    button.classList.toggle('is-active', profile.id === activeProfileId);
    button.disabled = state.switchingProfileId != null;

    const currentPort =
      dashboard.device?.profileId === profile.id && dashboard.device?.configuredPort
        ? `live ${dashboard.device.configuredPort}`
        : `default ${profile.defaultPort}`;
    const iconTone = getIconTone(profile.transport);

    button.innerHTML = `
      <span class="profile-card-main">
        <span class="profile-icon ${iconTone}" aria-hidden="true">
          ${getProtocolIconMarkup(profile.transport)}
        </span>
        <span class="profile-card-copy">
          <span class="profile-card-top">
            <span class="profile-brand">${profile.manufacturerName}</span>
            <span class="profile-transport">${formatTransport(profile.transport)}</span>
          </span>
          <strong>${profile.productName || profile.title}</strong>
        </span>
      </span>
      <span class="profile-meta">
        <span class="profile-chip">${profile.compatibility}</span>
        <span class="profile-chip">${currentPort}</span>
        <span class="profile-chip">${profile.id === activeProfileId ? 'Active' : 'Switch'}</span>
      </span>
    `;

    els.profileGrid.appendChild(button);
  });
}

function renderDeviceSummary(dashboard) {
  const device = dashboard.device;
  const profile = dashboard.profile;

  if (!device || !profile) {
    renderDeviceIcon(null);
    els.deviceTitle.textContent = 'No device selected';
    els.deviceDescription.textContent = 'The simulator is waiting for an active device profile.';
    clearElement(els.deviceBadges);
    els.deviceNotes.innerHTML = '<li>No profile notes available.</li>';
    return;
  }

  renderDeviceIcon(profile);
  els.deviceTitle.textContent = profile.productName || profile.title;
  els.deviceDescription.textContent = profile.description;

  clearElement(els.deviceBadges);
  [formatTransport(profile.transport), profile.manufacturerName, profile.productName || profile.title]
    .filter(Boolean)
    .forEach((label) => {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = label;
      els.deviceBadges.appendChild(badge);
    });

  clearElement(els.deviceNotes);
  const notes = Array.isArray(profile.notes) && profile.notes.length > 0
    ? profile.notes.slice(0, 3)
    : ['No protocol notes provided.'];

  notes.forEach((note) => {
    const item = document.createElement('li');
    item.textContent = note;
    els.deviceNotes.appendChild(item);
  });
}

function renderConnectionGrid(dashboard) {
  clearElement(els.connectionGrid);
  const rows = dashboard.protocolPreview?.connection || [];

  if (rows.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'info-item';
    placeholder.innerHTML = `
      <span class="info-label">Connection</span>
      <strong>Waiting for simulator data</strong>
      <span class="info-note">Load a profile to see host, port, and protocol details here.</span>
    `;
    els.connectionGrid.appendChild(placeholder);
  }

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'info-item';
    item.innerHTML = `
      <span class="info-label">${row.label}</span>
      <strong>${row.value}</strong>
      ${row.note ? `<span class="info-note">${row.note}</span>` : ''}
    `;
    els.connectionGrid.appendChild(item);
  });

  const latestTraffic = dashboard.traffic?.[0] || null;
  if (!latestTraffic) {
    els.activityLine.textContent = 'Waiting for protocol traffic.';
    return;
  }

  const detail = latestTraffic.protocol === 'http'
    ? `${latestTraffic.method || 'GET'} ${latestTraffic.requestTarget || '/'}`
    : `FC${String(latestTraffic.functionCode ?? '').padStart(2, '0')} ${latestTraffic.bank || ''} ${latestTraffic.startAddress ?? ''}`.trim();

  els.activityLine.textContent = `Latest request ${formatTimestamp(latestTraffic.timestamp)} · ${detail} · ${latestTraffic.outcome}`;
}

function createSectionHeader(section) {
  const header = document.createElement('div');
  header.className = 'section-head section-head-inner';
  header.innerHTML = `
    <div>
      <h3>${section.title}</h3>
      ${section.description ? `<p class="section-copy">${section.description}</p>` : ''}
    </div>
    ${section.endpoint ? `<code>${section.method || 'GET'} ${section.endpoint}</code>` : ''}
  `;
  return header;
}

function renderTableSection(section, card) {
  const list = document.createElement('div');
  list.className = 'table-list';

  (section.rows || []).forEach((row) => {
    const item = document.createElement('div');
    item.className = 'table-row';
    item.innerHTML = `
      <span class="table-label">${row.label}</span>
      <strong>${row.value}</strong>
      ${row.note ? `<span class="table-note">${row.note}</span>` : ''}
    `;
    list.appendChild(item);
  });

  card.appendChild(list);
}

function renderJsonSection(section, card) {
  const pre = document.createElement('pre');
  pre.className = 'code-block';
  pre.textContent = JSON.stringify(section.payload ?? {}, null, 2);
  card.appendChild(pre);
}

function renderRegisterBlock(section, card) {
  const meta = document.createElement('div');
  meta.className = 'register-meta';
  meta.innerHTML = `
    <span>FC${String(section.functionCode ?? '').padStart(2, '0')}</span>
    <span>${section.bank || 'holding'}</span>
    <span>start ${section.startAddress ?? 0}</span>
    <span>qty ${section.quantity ?? 0}</span>
  `;
  card.appendChild(meta);

  const grid = document.createElement('div');
  grid.className = 'word-grid';

  (section.words || []).forEach((word, index) => {
    const address = (section.startAddress ?? 0) + index;
    const cell = document.createElement('div');
    cell.className = 'word-cell';
    cell.innerHTML = `
      <span class="word-address">${String(address).padStart(4, '0')}</span>
      <strong>${word}</strong>
    `;
    grid.appendChild(cell);
  });

  card.appendChild(grid);
}

function renderTextSection(section, card) {
  const list = document.createElement('div');
  list.className = 'command-list';

  (section.lines || []).forEach((line) => {
    const code = document.createElement('code');
    code.textContent = line;
    list.appendChild(code);
  });

  card.appendChild(list);
}

function renderProtocolSections(dashboard) {
  clearElement(els.protocolSections);
  const preview = dashboard.protocolPreview;

  if (!preview) {
    els.protocolTitle.textContent = 'No protocol preview';
    els.protocolSummary.textContent = 'Protocol output will be available after a device profile is loaded.';
    return;
  }

  els.protocolTitle.textContent = preview.title;
  els.protocolSummary.textContent = preview.summary;

  preview.sections.forEach((section) => {
    const card = document.createElement('article');
    card.className = 'protocol-card';
    card.appendChild(createSectionHeader(section));

    if (section.kind === 'table') {
      renderTableSection(section, card);
    } else if (section.kind === 'json') {
      renderJsonSection(section, card);
    } else if (section.kind === 'register-block') {
      renderRegisterBlock(section, card);
    } else if (section.kind === 'text') {
      renderTextSection(section, card);
    }

    els.protocolSections.appendChild(card);
  });
}

function renderDashboard(dashboard) {
  state.dashboard = dashboard;
  renderConnectionPill(dashboard);
  renderProfileGrid(dashboard);
  renderDeviceSummary(dashboard);
  renderConnectionGrid(dashboard);
  renderProtocolSections(dashboard);
}

async function loadDashboard() {
  const dashboard = await api('/api/dashboard');
  renderDashboard(dashboard);
}

async function switchProfile(profileId) {
  state.switchingProfileId = profileId;
  els.connectionPill.textContent = `Switching to ${profileId}`;

  try {
    await api('/api/device/switch', {
      method: 'POST',
      body: JSON.stringify({
        productId: profileId
      })
    });
    await loadDashboard();
  } catch (error) {
    els.activityLine.textContent = `Switch failed: ${getErrorMessage(error)}`;
    throw error;
  } finally {
    state.switchingProfileId = null;
  }
}

function bindEvents() {
  els.refreshButton?.addEventListener('click', () => {
    void loadDashboard().catch((error) => {
      els.activityLine.textContent = `Refresh failed: ${getErrorMessage(error)}`;
    });
  });

  els.tabLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const sectionId = (link.getAttribute('href') || '#devices').slice(1);
      setActiveTab(sectionId);
    });
  });

  els.profileGrid?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-profile-id]') : null;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const profileId = target.dataset.profileId;
    if (!profileId || profileId === state.dashboard?.device?.profileId || state.switchingProfileId) {
      return;
    }

    void switchProfile(profileId).catch(() => {});
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visibleEntry) {
          setActiveTab(visibleEntry.target.id);
        }
      },
      {
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0.2, 0.45, 0.7]
      }
    );

    els.tabLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) {
        return;
      }

      const target = document.querySelector(href);
      if (target) {
        observer.observe(target);
      }
    });
  }
}

async function bootstrap() {
  bindEvents();
  setActiveTab((window.location.hash || '#devices').slice(1));
  await loadDashboard();

  state.refreshTimer = window.setInterval(() => {
    void loadDashboard().catch((error) => {
      els.activityLine.textContent = `Auto refresh failed: ${getErrorMessage(error)}`;
    });
  }, 3000);
}

bootstrap().catch((error) => {
  els.connectionPill.textContent = 'Error';
  els.activityLine.textContent = getErrorMessage(error);
});
