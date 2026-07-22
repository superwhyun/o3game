/**
 * TechTreeManager.js
 * Visual editor for game entity requirements and stats.
 * Uses SVG for Elbow (90-degree) connectors and HTML for nodes.
 */
import { adminService } from '../services/AdminService.js';

export class TechTreeManager {
  constructor() {
    this.nodes = new Map(); // entityId -> Node object
    this.edges = []; // Array of { from, to } connection objects
    this.entities = []; // Raw entity data from server
    
    // UI state
    this.selectedNodeId = null;
    this.isDragging = false;
    this.dragTarget = null;
    this.dragOffset = { x: 0, y: 0 };
    this.zoom = 1.0;
    this.pan = { x: 100, y: 100 };
    
    // DOM Elements
    this.canvas = null;
    this.nodeLayer = null;
    this.svgLayer = null;
    this.inspector = null;
  }

  async init() {
    this.canvas = document.getElementById('tt-canvas');
    this.nodeLayer = document.getElementById('tt-node-layer');
    this.svgLayer = document.getElementById('tt-svg-layer');
    this.inspector = document.getElementById('tt-inspector');
    
    this._bindEvents();
    await this.load();
  }

  async load() {
    this._showMessage('로드 중...', 'info');
    try {
      // Fetch all three types to build the full tree
      const [buildings, research, ships, defense] = await Promise.all([
        adminService.getEntityConfig('building'),
        adminService.getEntityConfig('research'),
        adminService.getEntityConfig('ship'),
        adminService.getEntityConfig('defense')
      ]);
      
      this.entities = [buildings, research, ships, defense].flat();
      this._buildGraph();
      this._render();
      this._showMessage('로드 완료', 'success');
    } catch (err) {
      this._showMessage('로드 실패: ' + err.message, 'error');
    }
  }

  _buildGraph() {
    this.nodes.clear();
    this.edges = [];

    // 1. Create Nodes
    this.entities.forEach(entity => {
      // Always use auto-layout as requested, ignoring saved positions
      const pos = this._getDefaultPosition(entity);
      
      this.nodes.set(entity.entityId, {
        ...entity,
        x: pos.x,
        y: pos.y,
        width: 200,
        height: 80
      });
    });

    // 2. Create Edges based on requirements
    this.nodes.forEach(node => {
      const reqs = node.requirements || {};
      
      // Check building requirements
      if (reqs.buildings) {
        Object.keys(reqs.buildings).forEach(reqId => {
          if (this.nodes.has(reqId)) {
            this.edges.push({ from: reqId, to: node.entityId, type: 'building' });
          }
        });
      }
      
      // Check research requirements
      if (reqs.research) {
        Object.keys(reqs.research).forEach(reqId => {
          if (this.nodes.has(reqId)) {
            this.edges.push({ from: reqId, to: node.entityId, type: 'research' });
          }
        });
      }
    });

    // Update UI stats
    document.getElementById('tt-node-count').textContent = `${this.nodes.size} Nodes`;
    document.getElementById('tt-edge-count').textContent = `${this.edges.length} Connections`;
  }

  _getDefaultPosition(entity) {
    // Simple vertical tiered layout based on entity type if no saved pos
    const types = ['building', 'research', 'ship', 'defense'];
    const typeIdx = types.indexOf(entity.entityType);
    
    // Find how many of this type we've placed already
    const count = Array.from(this.nodes.values()).filter(n => n.entityType === entity.entityType).length;
    
    return {
      x: 100 + (typeIdx * 400),
      y: 100 + (count * 120)
    };
  }

  _render() {
    if (!this.nodeLayer) return;
    
    this.nodeLayer.innerHTML = '';
    this.svgLayer.innerHTML = '';

    // Render Nodes
    this.nodes.forEach(node => {
      const el = document.createElement('div');
      el.className = `tt-node ${this.selectedNodeId === node.entityId ? 'selected' : ''}`;
      el.dataset.id = node.entityId;
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.dataset.type = node.entityType;

      const name = node.display?.name || node.entityId;
      const icon = node.display?.icon || '📦';

      el.innerHTML = `
        <div class="tt-node-header">
          <span class="tt-node-icon">${icon}</span>
          <span class="tt-node-name">${name}</span>
        </div>
        <div class="tt-node-body">
          <div class="tt-node-type">${node.entityType}</div>
        </div>
        <div class="tt-port input"></div>
        <div class="tt-port output"></div>
      `;

      el.addEventListener('mousedown', (e) => this._onNodeMouseDown(e, node));
      el.addEventListener('click', (e) => this._selectNode(node.entityId));
      
      this.nodeLayer.appendChild(el);
    });

    // Render Edges
    this._renderEdges();
    this._applyTransform();
    console.log(`[TechTreeManager] Rendered ${this.nodes.size} nodes and ${this.edges.length} edges.`);
  }

  _renderEdges() {
    if (!this.svgLayer) return;
    this.svgLayer.innerHTML = '';

    this.edges.forEach(edge => {
      const fromNode = this.nodes.get(edge.from);
      const toNode = this.nodes.get(edge.to);
      if (!fromNode || !toNode) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      
      // Highlight logic: if the target (to) or source (from) is the selected node
      const isInput = edge.to === this.selectedNodeId;
      const isOutput = edge.from === this.selectedNodeId;
      
      path.className.baseVal = `tt-connector ${isInput ? 'highlight-in' : ''} ${isOutput ? 'highlight-out' : ''}`;
      
      // Calculate ports (Simple middle-right to middle-left)
      const x1 = fromNode.x + fromNode.width;
      const y1 = fromNode.y + fromNode.height / 2;
      const x2 = toNode.x;
      const y2 = toNode.y + toNode.height / 2;

      // Smooth Bezier Curve routing
      const offsetX = Math.abs(x2 - x1) * 0.5;
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + offsetX} ${y1}, ${x2 - offsetX} ${y2}, ${x2} ${y2}`);
      this.svgLayer.appendChild(path);
    });
  }

  _applyTransform() {
    this.canvas.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
  }

  _bindEvents() {
    // Canvas Pan
    this.canvas.parentElement.addEventListener('mousedown', (e) => {
      // If we clicked on a node or its children, don't pan
      if (e.target.closest('.tt-node')) return;
      
      this.isPanning = true;
      this.panStart = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging && this.dragTarget) {
        if (this._updatePending) return;
        this._updatePending = true;

        requestAnimationFrame(() => {
          const node = this.nodes.get(this.dragTarget);
          if (node) {
            node.x = (e.clientX - this.panStart.x) / this.zoom;
            node.y = (e.clientY - this.panStart.y) / this.zoom;
            
            const el = document.querySelector(`.tt-node[data-id="${this.dragTarget}"]`);
            if (el) {
              el.style.left = `${node.x}px`;
              el.style.top = `${node.y}px`;
            }
            this._renderEdges();
          }
          this._updatePending = false;
        });
      } else if (this.isPanning) {
        if (this._updatePending) return;
        this._updatePending = true;

        requestAnimationFrame(() => {
          this.pan.x = e.clientX - this.panStart.x;
          this.pan.y = e.clientY - this.panStart.y;
          this._applyTransform();
          this._updatePending = false;
        });
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.dragTarget = null;
      this.isPanning = false;
    });

    // Toolbar actions
    document.getElementById('tt-btn-save')?.addEventListener('click', () => this._savePositions());
    document.getElementById('tt-btn-auto-layout')?.addEventListener('click', () => this._autoLayout());
    document.getElementById('tt-btn-close-inspector')?.addEventListener('click', () => this._closeInspector());
    
    // Side Inspector form Delegation
    this.inspector.addEventListener('change', (e) => this._onInspectorChange(e));
  }

  _onNodeMouseDown(e, node) {
    e.stopPropagation();
    this.isDragging = true;
    this.dragTarget = node.entityId;
    this.panStart = { 
      x: e.clientX - (node.x * this.zoom), 
      y: e.clientY - (node.y * this.zoom) 
    };
  }

  _selectNode(nodeId) {
    this.selectedNodeId = nodeId;
    
    // Highlight connections
    document.querySelectorAll('.tt-node').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === nodeId);
    });
    
    this._openInspector(nodeId);
  }

  _openInspector(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    this.inspector.classList.remove('hidden');
    document.getElementById('tt-inspector-name').textContent = node.display?.name || nodeId;
    
    const body = document.getElementById('tt-inspector-body');
    const reqs = node.requirements || {};
    
    body.innerHTML = `
      <div class="tt-prop-group">
        <h5>Base Information</h5>
        <div class="tt-field">
          <label>Internal ID</label>
          <input type="text" value="${node.entityId}" disabled>
        </div>
        <div class="tt-field">
          <label>Display Name</label>
          <input type="text" data-field="name" value="${node.display?.name || ''}">
        </div>
      </div>
      
      <div class="tt-prop-group">
        <h5>Requirements</h5>
        <div id="inspector-reqs-list">
          ${this._renderRequirementsList(reqs)}
        </div>
        <button class="tt-btn" style="width:100%; margin-top:10px;" id="tt-btn-add-req">+ Add Requirement</button>
      </div>

      <div class="tt-prop-group">
        <h5>Cost & Time Settings</h5>
        <div class="tt-field">
          <label>Metal (Base)</label>
          <input type="number" data-field="metal" value="${node.costModel?.baseCost?.metal || 0}">
        </div>
        <div class="tt-field">
          <label>Crystal (Base)</label>
          <input type="number" data-field="crystal" value="${node.costModel?.baseCost?.crystal || 0}">
        </div>
        <div class="tt-field">
          <label>Deuterium (Base)</label>
          <input type="number" data-field="deuterium" value="${node.costModel?.baseCost?.deuterium || 0}">
        </div>
        <div class="tt-field" style="margin-top:10px; border-top:1px solid rgba(0,255,255,0.1); padding-top:10px;">
          <label>Cost Multiplier</label>
          <input type="number" data-field="costMultiplier" step="0.05" value="${node.costModel?.costMultiplier || 1.5}">
          <small style="font-size:0.7rem; opacity:0.6;">exponential scaling per level</small>
        </div>
        <div class="tt-field">
          <label>Base Build Time (sec)</label>
          <input type="number" data-field="baseTime" value="${node.timeModel?.baseTime || 0}">
        </div>
      </div>

      ${node.entityType === 'ship' ? `
      <div class="tt-prop-group">
        <h5>Ship Stats</h5>
        <div class="tt-stat-grid">
          <div class="tt-field">
            <label>Hull</label>
            <input type="number" data-field="hull" value="${node.stats?.hull || 0}">
          </div>
          <div class="tt-field">
            <label>Shield</label>
            <input type="number" data-field="shield" value="${node.stats?.shield || 0}">
          </div>
          <div class="tt-field">
            <label>Attack</label>
            <input type="number" data-field="attack" value="${node.stats?.attack || 0}">
          </div>
          <div class="tt-field">
            <label>Speed</label>
            <input type="number" data-field="speed" value="${node.stats?.speed || 0}">
          </div>
          <div class="tt-field">
            <label>Cargo</label>
            <input type="number" data-field="cargo" value="${node.stats?.cargo || 0}">
          </div>
          <div class="tt-field">
            <label>Fuel</label>
            <input type="number" data-field="fuel" value="${node.stats?.fuel || 0}">
          </div>
        </div>
        <div class="tt-field" style="margin-top:10px;">
          <label>Engine Type</label>
          <select data-field="engineType" class="tt-select">
            <option value="none" ${node.stats?.engineType === 'none' ? 'selected' : ''}>None</option>
            <option value="combustion" ${node.stats?.engineType === 'combustion' ? 'selected' : ''}>Combustion</option>
            <option value="impulse" ${node.stats?.engineType === 'impulse' ? 'selected' : ''}>Impulse</option>
            <option value="hyperspace" ${node.stats?.engineType === 'hyperspace' ? 'selected' : ''}>Hyperspace</option>
          </select>
        </div>
      </div>
      ` : ''}
    `;

    // Bind specific inner events
    document.getElementById('tt-btn-add-req')?.addEventListener('click', () => this._addRequirementPrompt(nodeId));

    // Bind remove buttons
    body.querySelectorAll('.tt-btn-remove-req').forEach(btn => {
      btn.onclick = () => {
        const rid = btn.dataset.reqId;
        const targetReq = this.nodes.get(rid);
        const targetKey = targetReq?.entityType === 'building' ? 'buildings' : 'research';
        if (node.requirements[targetKey]) {
          delete node.requirements[targetKey][rid];
          this._buildGraph();
          this._render(); // Full re-render to cleanup
          this._openInspector(nodeId); // Refresh inspector
          this._showMessage('선행 조건 삭제됨', 'info');
        }
      };
    });
  }

  _renderRequirementsList(reqs) {
    let html = '';
    const allReqs = { ...(reqs.buildings || {}), ...(reqs.research || {}) };
    
    if (Object.keys(allReqs).length === 0) return '<p style="opacity:0.5; font-size:0.8rem;">No requirements defined.</p>';

    for (const [id, level] of Object.entries(allReqs)) {
      html += `
        <div class="tt-field" style="flex-direction:row; align-items:center; gap:10px;">
          <span style="flex:1; font-size:0.85rem;">${id}</span>
          <input type="number" value="${level}" style="width:50px;" data-req-id="${id}">
          <button class="tt-btn-remove-req" data-req-id="${id}" style="background:none; border:none; color:red; cursor:pointer; font-size:1.2rem; line-height:1;">&times;</button>
        </div>
      `;
    }
    return html;
  }

  _closeInspector() {
    this.inspector.classList.add('hidden');
    this.selectedNodeId = null;
    document.querySelectorAll('.tt-node').forEach(el => el.classList.remove('selected'));
  }

  async _savePositions() {
    this._showMessage('저장 중...', 'info');
    
    if (!this.nodes || this.nodes.size === 0) {
      console.warn('[TechTree] No nodes to save.');
      this._showMessage('저장 실패: 저장할 데이터가 없습니다 (테크트리가 비어 있음)', 'error');
      return;
    }

    const validTypes = ['building', 'ship', 'research', 'defense'];
    const invalidNodes = Array.from(this.nodes.values()).filter(node => !node.entityType || !validTypes.includes(node.entityType));
    
    if (invalidNodes.length > 0) {
      console.error('Invalid nodes found during save:', invalidNodes);
      this._showMessage(`저장 실패: 일부 노드에 유효한 타입이 없습니다 (${invalidNodes.map(n => n.entityId).join(', ')})`, 'error');
      return;
    }

    const updates = Array.from(this.nodes.values()).map(node => ({
      entityType: node.entityType,
      entityId: node.entityId,
      display: node.display,
      requirements: node.requirements,
      costModel: node.costModel,
      timeModel: node.timeModel,
      stats: node.stats
    }));

    console.log('[TechTree] Sending bulk update:', updates);

    try {
      await adminService.bulkUpdateEntityConfig(updates);
      this._showMessage('레이아웃 저장 완료', 'success');
    } catch (err) {
      this._showMessage('저장 실패: ' + err.message, 'error');
    }
  }

  _autoLayout() {
    // Very basic layout
    let x = 100;
    const types = ['building', 'research', 'ship'];
    
    types.forEach(type => {
      let y = 100;
      Array.from(this.nodes.values())
        .filter(n => n.entityType === type)
        .forEach(node => {
          node.x = x;
          node.y = y;
          y += 120;
        });
      x += 400;
    });
    
    this._render();
    this._showMessage('자동 배치 적용됨 (저장 버튼을 눌러 확정)', 'info');
  }

  _showMessage(text, type = 'info') {
    const el = document.getElementById('tt-message');
    if (!el) return;
    el.textContent = text;
    el.className = `tt-message tt-message-${type}`;
    setTimeout(() => { el.textContent = ''; }, 3000);
  }

  _onInspectorChange(e) {
    const node = this.nodes.get(this.selectedNodeId);
    if (!node) return;

    const field = e.target.dataset.field;
    const reqId = e.target.dataset.reqId; 
    const value = e.target.value;

    if (field === 'name') {
      if (!node.display) node.display = {};
      node.display.name = value;
      const el = document.querySelector(`.tt-node[data-id="${node.entityId}"] .tt-node-name`);
      if (el) el.textContent = value;
    } else if (reqId) {
      // Handle requirement level change
      const targetReq = this.nodes.get(reqId);
      const targetKey = targetReq?.entityType === 'building' ? 'buildings' : 'research';
      if (!node.requirements) node.requirements = {};
      if (!node.requirements[targetKey]) node.requirements[targetKey] = {};
      
      const level = parseInt(value);
      if (isNaN(level) || level <= 0) {
        delete node.requirements[targetKey][reqId];
      } else {
        node.requirements[targetKey][reqId] = level;
      }
      this._buildGraph();
      this._renderEdges();
    } else if (['metal', 'crystal', 'deuterium'].includes(field)) {
      if (!node.costModel) node.costModel = { baseCost: {} };
      node.costModel.baseCost[field] = parseFloat(value) || 0;
    } else if (field === 'costMultiplier') {
      if (!node.costModel) node.costModel = { baseCost: {} };
      node.costModel.costMultiplier = parseFloat(value) || 1.5;
    } else if (field === 'baseTime') {
      if (!node.timeModel) node.timeModel = { baseTime: 0 };
      node.timeModel.baseTime = parseFloat(value) || 0;
    } else if (['hull', 'shield', 'attack', 'speed', 'cargo', 'fuel', 'engineType'].includes(field)) {
      if (!node.stats) node.stats = {};
      node.stats[field] = field === 'engineType' ? value : parseFloat(value) || 0;
    }


    this._showMessage('변경됨 (저장 필요)', 'info');
  }

  _addRequirementPrompt(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Show a simple list of other entities to add as requirement
    const otherNodes = Array.from(this.nodes.values())
      .filter(n => n.entityId !== nodeId)
      .map(n => `<option value="${n.entityId}">${n.display?.name || n.entityId}</option>`)
      .join('');

    const body = document.getElementById('tt-inspector-body');
    const dialog = document.createElement('div');
    dialog.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:#001520; border:2px solid #00ffff; padding:20px; z-index:100; box-shadow:0 0 30px rgba(0,255,255,0.5);';
    dialog.innerHTML = `
      <h3 style="margin-top:0; color:#00ffff;">Add Requirement</h3>
      <select id="tt-new-req-id" style="width:100%; padding:10px; background:#000; color:#00ffff; border:1px solid #00ffff;">
        ${otherNodes}
      </select>
      <div style="margin-top:15px; display:flex; gap:10px;">
        <button id="tt-confirm-req" class="tt-btn tt-btn-primary" style="flex:1;">ADD</button>
        <button id="tt-cancel-req" class="tt-btn" style="flex:1;">CANCEL</button>
      </div>
    `;
    document.body.appendChild(dialog);

    document.getElementById('tt-cancel-req').onclick = () => document.body.removeChild(dialog);
    document.getElementById('tt-confirm-req').onclick = () => {
      const reqId = document.getElementById('tt-new-req-id').value;
      const reqNode = this.nodes.get(reqId);
      
      if (!node.requirements) node.requirements = {};
      const targetKey = reqNode.entityType === 'building' ? 'buildings' : 'research';
      if (!node.requirements[targetKey]) node.requirements[targetKey] = {};
      
      node.requirements[targetKey][reqId] = 1; // Default level 1
      
      document.body.removeChild(dialog);
      this._buildGraph(); // Recalculate edges
      this._render(); // Full re-render to show new line
      this._openInspector(nodeId); // Refresh inspector
      this._showMessage('선행 조건 추가됨', 'success');
    };
  }
}
