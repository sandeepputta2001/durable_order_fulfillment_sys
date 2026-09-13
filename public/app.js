// Vanilla JS, no build step - fetches the same REST API documented at
// /docs. Kept deliberately framework-free to match the rest of this POC's
// "boring technology" approach: one static bundle, nothing to compile.

function shortOrderId(id) {
  // "order-<uuid>" -> just the first segment of the uuid, e.g. "94eb0b32" -
  // full id is still in the title attribute and the detail modal.
  const withoutPrefix = id.replace(/^order-/, '');
  return withoutPrefix.split('-')[0];
}

const PRODUCTS = [
  { id: 'product-1', label: 'product-1 (in stock)' },
  { id: 'product-2', label: 'product-2 (in stock)' },
  { id: 'product-3', label: 'product-3 (in stock)' },
  { id: 'product-oos', label: 'product-oos (0 stock - triggers business failure)' },
];

const itemsEl = document.getElementById('items');
const addItemBtn = document.getElementById('add-item');
const form = document.getElementById('order-form');
const submitBtn = document.getElementById('submit-btn');
const submitLabel = document.getElementById('submit-label');
const feedbackEl = document.getElementById('form-feedback');
const ordersBody = document.getElementById('orders-body');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const overlay = document.getElementById('detail-overlay');
const detailTitle = document.getElementById('detail-title');
const detailBody = document.getElementById('detail-body');
const detailClose = document.getElementById('detail-close');

function productOptionsHtml(selected) {
  return PRODUCTS.map(
    (p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.label}</option>`,
  ).join('');
}

function addItemRow(productId = PRODUCTS[0].id, quantity = 1) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <select class="item-product">${productOptionsHtml(productId)}</select>
    <input class="item-qty" type="number" min="1" value="${quantity}" />
    <button type="button" class="item-remove" aria-label="Remove item">&times;</button>
  `;
  row.querySelector('.item-remove').addEventListener('click', () => {
    if (itemsEl.children.length > 1) row.remove();
  });
  itemsEl.appendChild(row);
}

addItemBtn.addEventListener('click', () => addItemRow());
addItemRow();

function readItems() {
  return Array.from(itemsEl.querySelectorAll('.item-row')).map((row) => ({
    productId: row.querySelector('.item-product').value,
    quantity: Number(row.querySelector('.item-qty').value) || 1,
  }));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const customerId = document.getElementById('customerId').value.trim();
  const items = readItems();

  submitBtn.disabled = true;
  submitLabel.textContent = 'Creating…';
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback';

  try {
    const response = await fetch('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, items }),
    });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.message || 'Request failed');
    }

    feedbackEl.textContent = `Created ${body.orderId} - status ${body.status}. Watch it in the table →`;
    feedbackEl.className = 'feedback ok';
    lastKnownStatus[body.orderId] = null; // force a flash once it appears
    await refreshOrders();
  } catch (err) {
    feedbackEl.textContent = err.message || 'Something went wrong';
    feedbackEl.className = 'feedback error';
  } finally {
    submitBtn.disabled = false;
    submitLabel.textContent = 'Create Order';
  }
});

function statusBadge(status) {
  return `<span class="badge badge-${status}"><span class="dot"></span>${status}</span>`;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const lastKnownStatus = {};

async function refreshOrders() {
  let orders;
  try {
    const response = await fetch('/orders?limit=50');
    ({ orders } = await response.json());
  } catch {
    return; // transient network hiccup - next poll will retry
  }

  if (orders.length === 0) {
    ordersBody.innerHTML =
      '<tr class="empty-row"><td colspan="5">No orders yet - create one to see it appear here.</td></tr>';
    return;
  }

  ordersBody.innerHTML = orders
    .map((order) => {
      const itemCount = order.itemCount ?? '';
      return `
        <tr data-id="${order.id}">
          <td class="order-id" title="${order.id}">${shortOrderId(order.id)}…</td>
          <td>${order.customerId}</td>
          <td>${itemCount}</td>
          <td>${statusBadge(order.status)}</td>
          <td class="muted">${timeAgo(order.updatedAt)}</td>
        </tr>`;
    })
    .join('');

  for (const order of orders) {
    const prev = lastKnownStatus[order.id];
    if (prev !== undefined && prev !== order.status) {
      const row = ordersBody.querySelector(`tr[data-id="${order.id}"]`);
      if (row) {
        row.classList.remove('flash');
        void row.offsetWidth; // restart the CSS animation
        row.classList.add('flash');
      }
    }
    lastKnownStatus[order.id] = order.status;
  }

  ordersBody.querySelectorAll('tr[data-id]').forEach((row) => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });
}

async function openDetail(orderId) {
  detailTitle.textContent = orderId;
  detailBody.innerHTML = '<dt>Loading…</dt><dd></dd>';
  overlay.hidden = false;

  try {
    const response = await fetch(`/orders/${encodeURIComponent(orderId)}`);
    const order = await response.json();
    const itemsHtml = (order.items || [])
      .map((item) => `${item.quantity} × ${item.productId}`)
      .join('<br/>');

    detailBody.innerHTML = `
      <dt>Status</dt><dd>${statusBadge(order.status)}</dd>
      <dt>Customer</dt><dd>${order.customerId}</dd>
      <dt>Items</dt><dd>${itemsHtml || '—'}</dd>
      <dt>Workflow ID</dt><dd>${order.id}</dd>
    `;
  } catch {
    detailBody.innerHTML = '<dt>Error</dt><dd>Could not load this order.</dd>';
  }
}

detailClose.addEventListener('click', () => (overlay.hidden = true));
overlay.addEventListener('click', (event) => {
  if (event.target === overlay) overlay.hidden = true;
});

async function refreshSystemStatus() {
  try {
    const response = await fetch('/ready');
    const body = await response.json();
    const ok = response.ok && body.status === 'ok';
    statusDot.className = `dot ${ok ? 'ok' : 'bad'}`;
    statusText.textContent = ok
      ? 'API ready'
      : `DB ${body.database ?? '?'} · Temporal ${body.temporal ?? '?'}`;
  } catch {
    statusDot.className = 'dot bad';
    statusText.textContent = 'API unreachable';
  }
}

refreshOrders();
refreshSystemStatus();
setInterval(refreshOrders, 3000);
setInterval(refreshSystemStatus, 5000);
