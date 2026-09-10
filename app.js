(function () {
  'use strict';

  const data = window.TRIP_DATA;
  const roadRoutes = validRoadRoutes(data.roadRoutes) ? data.roadRoutes : null;
  const roadRoutesByDay = roadRoutes?.days || Object.create(null);
  const $ = (selector) => document.querySelector(selector);
  let map;
  let activeRouteLayer;
  const markers = new Map();

  function validRoadRoutes(value) {
    if (!value || typeof value !== 'object' || !value.days || typeof value.days !== 'object') return false;
    if (typeof value.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.generatedAt)) return false;

    return data.days.every((day) => {
      const route = value.days[day.id];
      if (!route || typeof route !== 'object') return false;
      if (route.status === 'fallback') return typeof route.reason === 'string' && route.reason.length > 0;
      if (route.status !== 'routed' || !Array.isArray(route.coordinates) || route.coordinates.length < 2) return false;
      return route.coordinates.every((coordinate) => Array.isArray(coordinate)
        && coordinate.length === 2
        && Number.isFinite(coordinate[0])
        && Number.isFinite(coordinate[1])
        && coordinate[0] >= -90 && coordinate[0] <= 90
        && coordinate[1] >= -180 && coordinate[1] <= 180);
    });
  }

  function routeDistanceKm(day) {
    const distanceMeters = roadRoutesByDay[day.id]?.distanceMeters;
    return Number.isFinite(distanceMeters) && distanceMeters >= 0
      ? Math.round(distanceMeters / 1000)
      : null;
  }

  function routeDistanceSummary() {
    const distances = data.days.map((day) => roadRoutesByDay[day.id]?.distanceMeters);
    const complete = distances.every((value) => Number.isFinite(value) && value >= 0);
    return complete
      ? {
          value: Math.round(distances.reduce((sum, value) => sum + value, 0) / 1000),
          label: '公里 · 计划路线'
        }
      : { value: data.meta.estimatedDistanceKm, label: '公里 · 估算' };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatDate(dateString) {
    const [year, month, day] = dateString.split('-');
    return `${year}.${month}.${day}`;
  }

  function formatShanghaiDate(timestamp) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}.${values.month}.${values.day}`;
  }

  function nextTripDay() {
    const today = new Date();
    const localKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
    return data.days.find((day) => day.date >= localKey) || data.days.at(-1);
  }

  function renderHero(day) {
    document.title = data.meta.title;
    $('#hero-title').innerHTML = data.meta.title.split('，')
      .map((part, index, parts) => `<span>${escapeHtml(part)}${index < parts.length - 1 ? '，' : ''}</span>`).join('');
    $('.hero-subtitle').textContent = data.meta.subtitle;
    $('.brand').textContent = data.meta.title;
    $('#trip-date-range').textContent = `${formatDate(data.meta.startDate)} — ${formatDate(data.meta.endDate)}`;
    $('#itinerary-heading').textContent = `${data.days.length} 天行程`;
    const label = day.date === data.meta.endDate && new Date() > new Date(`${data.meta.endDate}T23:59:59`)
      ? '旅程已结束 · 随时回来重温'
      : `${formatDate(day.date).slice(5)} · ${day.title}`;
    $('#hero-next').textContent = label;
  }

  function renderMetrics() {
    const routeDistance = routeDistanceSummary();
    const metrics = [
      [String(data.days.length), `天 / ${data.days.length - 1} 晚`],
      [routeDistance.value.toLocaleString('zh-CN'), routeDistance.label],
      [String(data.routeStops.length), '个主要停靠点'],
      [data.meta.highestAltitude, '预计最高海拔']
    ];
    $('#trip-metrics').innerHTML = metrics.map(([value, label], index) => `
      <article class="metric-card">
        <span class="metric-index">0${index + 1}</span>
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(label)}</span>
      </article>
    `).join('');
  }

  function renderRouteSummary() {
    $('#route-summary').innerHTML = `
      <div class="route-summary-head">
        <span>完整路线</span>
        <small>${data.routeStops.length} STOPS</small>
      </div>
      <ol>
        ${data.routeStops.map((stop, index) => `
          <li>
            <button type="button" class="stop-button" data-stop-id="${escapeHtml(stop.id)}"
              data-day-id="${escapeHtml(stop.dayIds[0])}" aria-label="查看${escapeHtml(stop.name)}对应行程">
              <span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(stop.name)}
            </button>
          </li>
        `).join('')}
      </ol>
      <p class="route-note"><span>!</span> 每日出发前复核沿途天气与路况。</p>
    `;
  }

  function statusBadge(day) {
    if (day.id === 'day-01') return '<span class="badge-row"><span class="status-badge suggested">建议行程</span><span class="status-badge confirmed">含已确认项目</span></span>';
    return `<span class="status-badge ${day.status}">${day.status === 'confirmed' ? '已确认' : '建议行程'}</span>`;
  }

  function renderDrivingSegments(day) {
    const points = data.routingPlans?.[day.id]?.waypoints;
    if (!Array.isArray(points) || points.length < 2) return '';
    const route = roadRoutesByDay[day.id];
    const legs = route?.status === 'routed' ? route.legDistancesMeters : null;
    const valid = Array.isArray(legs) && legs.length === points.length - 1
      && legs.every(value => Number.isFinite(value) && value >= 0)
      && Number.isFinite(route.distanceMeters)
      && Math.abs(legs.reduce((sum, value) => sum + value, 0) - route.distanceMeters) <= Math.max(1, legs.length * 0.1);
    return `<div class="driving-segments">
      <h3>分段驾车里程</h3>
      <ol>${points.slice(1).map((point, index) => `<li>
        <span>${escapeHtml(points[index].name)} → ${escapeHtml(point.name)}</span>
        <b>${valid ? `约 ${(legs[index] / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 公里` : '分段里程待确认'}</b>
      </li>`).join('')}</ol>
      <p>按计划道路路线计算，不含临时绕行及酒店接驳。</p>
    </div>`;
  }

  function renderDays(initialDayId) {
    $('#day-list').innerHTML = data.days.map((day, index) => `
      <article class="day-card" id="${escapeHtml(day.id)}" data-day-id="${escapeHtml(day.id)}">
        <button class="day-card-toggle" type="button" aria-expanded="${day.id === initialDayId ? 'true' : 'false'}"
          aria-controls="${escapeHtml(day.id)}-details">
          <span class="day-number">${String(index + 1).padStart(2, '0')}</span>
          <span class="day-date"><b>${formatDate(day.date).slice(5)}</b>${escapeHtml(day.weekday)}</span>
          <span class="day-heading">
            ${statusBadge(day)}
            <strong>${escapeHtml(day.title)}</strong>
            <small>${escapeHtml(day.from)} <i>→</i> ${escapeHtml(day.to)}</small>
          </span>
          <span class="day-meta"><b>${routeDistanceKm(day) ?? day.distanceKm} km</b><small>${escapeHtml(day.driveTime)}</small></span>
          <span class="toggle-icon" aria-hidden="true"></span>
        </button>
        <div class="day-details" id="${escapeHtml(day.id)}-details" ${day.id === initialDayId ? '' : 'hidden'}>
          <div class="day-story">
            <p>${escapeHtml(day.summary)}</p>
            <div class="day-facts">
              <span><small>海拔</small>${escapeHtml(day.altitude)}</span>
              <span><small>住宿</small>${escapeHtml(day.stay)}</span>
            </div>
          </div>
          ${renderDrivingSegments(day)}
          <div class="activity-block">
            <h3>今日节奏</h3>
            <ol>${day.activities.map((activity) => `<li>${escapeHtml(activity)}</li>`).join('')}</ol>
          </div>
          ${day.notices.length ? `
            <div class="notice-block">
              <h3>路上提醒</h3>
              <ul>${day.notices.map((notice) => `<li>${escapeHtml(notice)}</li>`).join('')}</ul>
            </div>
          ` : ''}
        </div>
      </article>
    `).join('');
  }

  function renderFlights() {
    $('#flight-list').innerHTML = Object.values(data.flights).map((flight) => `
      <article class="flight-card">
        <div class="flight-card-head">
          <span>${escapeHtml(flight.direction)} · ${formatDate(flight.date)}</span>
          <span class="status-badge confirmed">已确认</span>
        </div>
        <div class="flight-number">${escapeHtml(flight.number)}</div>
        <div class="flight-route">
          <div><strong>${escapeHtml(flight.departure)}</strong><span>${escapeHtml(flight.from)}</span></div>
          <div class="flight-line"><span aria-hidden="true">✈</span></div>
          <div><strong>${escapeHtml(flight.arrival)}</strong><span>${escapeHtml(flight.to)}</span></div>
        </div>
      </article>
    `).join('');
  }

  function renderVehicle() {
    const vehicle = data.vehicle;
    const hotel = data.confirmedHotels[0];
    $('#vehicle-card').innerHTML = `
      <article class="vehicle-main">
        <div>
          <span class="info-kicker">ROAD PARTNER</span>
          <h3>${escapeHtml(vehicle.model)}</h3>
          <p>${escapeHtml(vehicle.location)}取还</p>
        </div>
        <strong class="plate-number">${escapeHtml(vehicle.plate)}</strong>
        <dl>
          <div><dt>取车</dt><dd>${escapeHtml(vehicle.pickupAt)}</dd></div>
          <div><dt>还车</dt><dd>${escapeHtml(vehicle.returnAt)}</dd></div>
        </dl>
      </article>
      <article class="hotel-main">
        <span class="info-kicker">FIRST NIGHT · 已确认</span>
        <h3>${escapeHtml(hotel.name)}</h3>
        <p>${formatDate(hotel.date)} · ${escapeHtml(hotel.city)}</p>
      </article>
    `;

    $('#source-list').innerHTML = `
      <p>路线灵感与景点资料</p>
      ${data.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)} <span aria-hidden="true">↗</span></a>`).join('')}
    `;
  }

  function bindCardToggles() {
    document.addEventListener('click', (event) => {
      const stopButton = event.target.closest('.stop-button');
      if (stopButton) {
        selectDay(stopButton.dataset.dayId, { scroll: true });
        return;
      }

      const toggle = event.target.closest('.day-card-toggle');
      if (!toggle) return;
      const card = toggle.closest('.day-card');
      const details = card.querySelector('.day-details');
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      details.hidden = expanded;
      card.toggleAttribute('data-open', !expanded);
      selectDay(card.dataset.dayId, { scroll: false });
    });
  }

  function showMapFallback() {
    const fallback = $('#map-fallback');
    fallback.hidden = false;
    $('#map').classList.add('map-unavailable');
  }

  function dayCoordinates(day) {
    const stopById = new Map(data.routeStops.map((stop) => [stop.id, stop]));
    return day.routeStopIds
      .map((id) => stopById.get(id))
      .filter(Boolean)
      .map((stop) => [stop.lat, stop.lng]);
  }

  function routeCoordinates(day) {
    const route = roadRoutesByDay[day.id];
    if (!route) return [];
    return route.status === 'fallback' ? dayCoordinates(day) : route.coordinates;
  }

  function overviewCoordinates() {
    const coordinates = [];
    for (const day of data.days) {
      routeCoordinates(day).forEach((coordinate, index) => {
        const previous = coordinates.at(-1);
        if (index === 0 && previous && previous[0] === coordinate[0] && previous[1] === coordinate[1]) return;
        coordinates.push(coordinate);
      });
    }
    return coordinates;
  }

  function renderRouteMetadata() {
    if (!roadRoutes) {
      $('#route-generated-at').textContent = '路线数据暂不可用';
      updateRouteStatus(null);
      return;
    }
    $('#route-generated-at').textContent = `数据更新于 ${formatShanghaiDate(roadRoutes.generatedAt)}`;
  }

  function updateRouteStatus(route) {
    const routeStatus = $('#route-status');
    if (!route) {
      routeStatus.hidden = false;
      routeStatus.textContent = '道路路线数据暂不可用，行程详情仍可正常查看。';
      return;
    }
    const isFallback = route.status === 'fallback';
    routeStatus.hidden = !isFallback;
    routeStatus.textContent = isFallback ? `此日暂用站点连线：${route.reason}` : '';
  }

  function selectDay(dayId, options = {}) {
    const day = data.days.find((item) => item.id === dayId);
    const card = document.querySelector(`.day-card[data-day-id="${dayId}"]`);
    if (!day || !card) return;

    document.querySelectorAll('.day-card[data-active]').forEach((item) => item.removeAttribute('data-active'));
    document.querySelectorAll('.stop-button[data-active]').forEach((item) => item.removeAttribute('data-active'));
    card.setAttribute('data-active', '');

    document.querySelectorAll(`.stop-button[data-day-id="${dayId}"]`).forEach((item) => item.setAttribute('data-active', ''));
    for (const [stopId, marker] of markers) {
      const element = marker.getElement();
      if (element) element.classList.toggle('is-active', day.routeStopIds.includes(stopId));
    }

    const route = roadRoutesByDay[day.id];
    const coordinates = routeCoordinates(day);
    const isFallback = route?.status === 'fallback';
    updateRouteStatus(route);
    if (options.updateMap !== false && map && activeRouteLayer && coordinates.length) {
      activeRouteLayer.setLatLngs(coordinates);
      activeRouteLayer.setStyle({ dashArray: isFallback ? '8 10' : null });
      if (options.fitMap !== false) {
        if (coordinates.length === 1) {
          map.setView(coordinates[0], Math.max(map.getZoom(), 8), { animate: !reduceMotion() });
        } else {
          map.fitBounds(coordinates, { padding: [54, 54], maxZoom: 9, animate: !reduceMotion() });
        }
      }
    }

    if (options.scroll) {
      const toggle = card.querySelector('.day-card-toggle');
      const details = card.querySelector('.day-details');
      toggle.setAttribute('aria-expanded', 'true');
      details.hidden = false;
      card.setAttribute('data-open', '');
      card.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function initMap(initialDayId) {
    if (!roadRoutes || !window.L) {
      showMapFallback();
      return;
    }

    try {
      map = window.L.map('map', { scrollWheelZoom: false, zoomControl: false, attributionControl: true });
      window.L.control.zoom({ position: 'bottomright' }).addTo(map);

      let tileErrors = 0;
      const tiles = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      });
      tiles.on('tileerror', () => {
        tileErrors += 1;
        if (tileErrors >= 4) showMapFallback();
      });
      tiles.addTo(map);

      const allCoordinates = overviewCoordinates();
      window.L.polyline(allCoordinates, { color: '#203c32', weight: 4, opacity: .68 }).addTo(map);
      activeRouteLayer = window.L.polyline([], { color: '#d9673e', weight: 6, opacity: .95 }).addTo(map);

      data.routeStops.forEach((stop, index) => {
        const icon = window.L.divIcon({
          className: 'route-marker-shell',
          html: `<span>${String(index + 1).padStart(2, '0')}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        });
        const marker = window.L.marker([stop.lat, stop.lng], { icon, title: stop.name })
          .addTo(map)
          .bindTooltip(stop.name, { direction: 'top', offset: [0, -15] });
        marker.on('click', () => selectDay(stop.dayIds[0], { scroll: true }));
        markers.set(stop.id, marker);
      });

      selectDay(initialDayId, { scroll: false, fitMap: false });
      map.fitBounds(allCoordinates, { padding: [42, 42] });
    } catch (error) {
      showMapFallback();
    }
  }

  function scrollToHash() {
    if (!window.location.hash) return;
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  function renderAll() {
    const initialDay = nextTripDay();
    renderHero(initialDay);
    renderMetrics();
    renderRouteSummary();
    renderRouteMetadata();
    renderDays(initialDay.id);
    renderFlights();
    renderVehicle();
    bindCardToggles();
    initMap(initialDay.id);
    window.requestAnimationFrame(scrollToHash);
    window.addEventListener('load', scrollToHash, { once: true });
  }

  renderAll();
}());
