import { escapeHtml as e, formatDuration } from '../dom.js';
import { ownerColor, progressOf, curveOf, pointOnCurve, endpointLabel } from './trafficMath.js';
const NS = 'http://www.w3.org/2000/svg';
let instance = 0;
function node(name, attrs = {}) {
 const el = document.createElementNS(NS, name);
 for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
 return el;
}
export class FleetTrafficLayer {
 constructor(chart, { onSelect, onMore, controlsRoot } = {}) {
  this.chart = chart; this.onSelect = onSelect; this.onMore = onMore;
  this.prefix = `traffic-${++instance}`; this.routes = []; this.filter = 'all'; this.selected = null; this.clockOffset = 0;
  this.root = document.createElement('section'); this.root.className = 'fleet-traffic';
  (controlsRoot || chart.container).appendChild(this.root);
  this.root.innerHTML = `<header><strong>함대 이동 <span data-traffic-count>0</span></strong><label>표시 <select data-traffic-filter aria-label="함대 이동 필터"><option value="all">전체</option><option value="self">내 함대</option><option value="others">다른 사용자</option><option value="incoming">내 행성으로 오는 이동</option></select></label></header><p class="traffic-status" role="status">이동 정보를 불러오는 중…</p><div class="traffic-owners" aria-label="함대 소유자 범례"></div><details class="traffic-list"><summary>항로 목록</summary><div data-traffic-routes></div></details><article class="traffic-detail" hidden></article>`;
  this.statusEl = this.root.querySelector('.traffic-status');
  this.root.addEventListener('change', ev => { if (ev.target.matches('[data-traffic-filter]')) { this.filter = ev.target.value; this.render(); } });
  this.root.addEventListener('click', ev => { const item = ev.target.closest('[data-traffic-route]'); if (item) this.select(item.dataset.trafficRoute); if (ev.target.closest('[data-traffic-more]')) this.onMore?.(); });
  chart.onRender = () => this.mount(); chart.onPlace = () => this.tick();
  this.mount();
 }
 update(data) {
  this.routes = [...data.routes].sort((a,b)=>a.id.localeCompare(b.id)); this.total = data.total; this.observedAt = data.serverTime;
  this.clockOffset = +new Date(data.serverTime) - Date.now();
  if (!this.routes.some(r => r.id === this.selected)) { this.selected = null; this.root.querySelector('.traffic-detail').hidden = true; }
  this.render();
  const selected = this.routes.find(r=>r.id===this.selected);
  if(selected){const eta=this.root.querySelector('.traffic-detail [data-traffic-eta]');if(eta)eta.dataset.trafficEta=selected.endsAt;}
  this.setStatus();
 }
 reset() { this.routes = []; this.total = 0; this.selected = null; this.observedAt = null; this.clockOffset = 0; this.root.querySelector('.traffic-detail').hidden = true; this.render(); this.setStatus(); }
 setStatus(error = '') {
  this.statusEl.textContent = error ? `연결 지연 · ${this.observedAt ? new Date(this.observedAt).toLocaleTimeString('ko-KR') + ' 관측 유지' : '다시 연결하는 중'}` : this.observedAt ? `${new Date(this.observedAt).toLocaleTimeString('ko-KR')} 갱신 · 외부 위치는 성계 단위로 표시` : '이동 정보를 불러오는 중…';
  this.statusEl.classList.toggle('is-stale', Boolean(error));
 }
 visibleRoutes() {
  return this.routes.filter(r => this.filter === 'all' || this.filter === 'self' && r.isSelf || this.filter === 'others' && !r.isSelf || this.filter === 'incoming' && this.chart.positions.some(p => p.owner === 'self' && p.position === r.to.planet));
 }
 mount() {
  this.svgGroup = node('g', { class: 'traffic-layer' });
  this.chart.svg.querySelector('.traffic-layer')?.remove();
  this.chart.svg.insertBefore(this.svgGroup, this.chart.svg.querySelector('.slots'));
  this.drawRoutes();
 }
 render() {
  const visible = this.visibleRoutes();
  this.root.querySelector('[data-traffic-count]').textContent = `${visible.reduce((n,r)=>n+r.count,0)} / ${this.total || 0}`;
  const owners = [...new Map(visible.map(r=>[r.ownerKey, r])).values()];
  this.root.querySelector('.traffic-owners').innerHTML = owners.map(r => `<span style="--traffic-color:${ownerColor(r.ownerKey,r.isSelf)}"><i></i>${e(r.isSelf?'내 함대':r.username)}</span>`).join('');
  this.root.querySelector('[data-traffic-routes]').innerHTML = visible.map(r=>`<button type="button" data-traffic-route="${e(r.id)}" style="--traffic-color:${ownerColor(r.ownerKey,r.isSelf)}" aria-pressed="${r.id===this.selected}"><i></i><span>${e(r.username)} · ${e(endpointLabel(r.from))} → ${e(endpointLabel(r.to))}<small>${r.status==='returning'?'귀환':'이동'} · ${r.count}개 이동</small></span><b data-traffic-eta="${e(r.endsAt)}"></b></button>`).join('') || '<p class="detail-muted">현재 표시할 이동이 없습니다.</p>';
  this.drawRoutes(); this.tick();
 }
 drawRoutes() {
  if (!this.svgGroup) return;
  this.svgGroup.replaceChildren(); this.drawn = [];
  const visible = this.visibleRoutes();
  const external = [...new Set(visible.flatMap(r=>[r.from,r.to]).filter(p=>p.planet===undefined).map(p=>`${p.galaxy}:${p.system}`))].sort();
  this.externalPoints = new Map();
  external.forEach((key,index)=>{
   const side = index%2, row = Math.floor(index/2), rows = Math.ceil(external.length/2);
   const point = { x: side?920:80, y: 95 + row*450/Math.max(1,rows-1) };
   this.externalPoints.set(key, point);
   const group = node('g', { class:'traffic-external', transform:`translate(${point.x} ${point.y})` });
   group.append(node('rect',{x:-65,y:-13,width:130,height:26,rx:8}));
   const text=node('text',{ 'text-anchor':'middle',y:5 });text.textContent=`[${key}] 성계`;group.append(text);this.svgGroup.append(group);
  });
  visible.forEach((r,index)=>{
   const color=ownerColor(r.ownerKey,r.isSelf), markerId=`${this.prefix}-head-${index}`;
   const marker=node('marker',{id:markerId,viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:6,markerHeight:6,orient:'auto'});
   marker.append(node('path',{d:'M0 0 L10 5 L0 10 Z',fill:color}));this.svgGroup.append(marker);
   const path=node('path',{class:`traffic-course ${r.status==='returning'?'is-returning':''}`,stroke:color,'marker-end':`url(#${markerId})`});
   const hit=node('path',{class:'traffic-hit',tabindex:0,role:'button','aria-label':`${r.username} ${endpointLabel(r.from)}에서 ${endpointLabel(r.to)} ${r.count}개 이동`});
   hit.addEventListener('click',()=>this.select(r.id));hit.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();this.select(r.id);}});
   const token=node('circle',{class:'traffic-token',r:r.id===this.selected?6:4,fill:color});
   const label=node('text',{class:'traffic-bundle',fill:color}); label.textContent=r.count>1?`${r.count}`:'';
   this.svgGroup.append(path,hit,token,label);
   this.drawn.push({r,path,hit,token,label,offset:index%5});
  });
  this.tick();
 }
 point(endpoint) { return endpoint.planet!==undefined ? this.chart.slotPoint(endpoint.planet) : this.externalPoints.get(`${endpoint.galaxy}:${endpoint.system}`); }
 tick() {
  const now=Date.now()+this.clockOffset;
  for(const item of this.drawn || []){
   const {r,path,hit,token,label}=item, from=this.point(r.from),to=this.point(r.to); if(!from||!to)continue;
   const curve=curveOf(from,to,item.offset), c=curve.control;
   const d=`M${from.x} ${from.y} Q${c.x} ${c.y} ${to.x} ${to.y}`;
   path.setAttribute('d',d);hit.setAttribute('d',d);
   path.classList.toggle('is-selected',r.id===this.selected);
   const p=pointOnCurve(curve,progressOf(r.startedAt,r.endsAt,now));
   token.setAttribute('cx',p.x);token.setAttribute('cy',p.y);label.setAttribute('x',p.x+9);label.setAttribute('y',p.y-7);
  }
  for(const el of this.root.querySelectorAll('[data-traffic-eta]')) { const remaining=(+new Date(el.dataset.trafficEta)-now)/1000; el.textContent=remaining>0?formatDuration(remaining):'도착 처리 중'; }
 }
 select(id) {
  this.selected=id;this.render();const r=this.routes.find(r=>r.id===id);if(!r)return;
  const detail=this.root.querySelector('.traffic-detail');detail.hidden=false;
  detail.innerHTML=`<h4>${e(r.username)} · ${r.status==='returning'?'귀환':'이동'}</h4><p>${e(endpointLabel(r.from))} → ${e(endpointLabel(r.to))}</p><p>${r.count}개 이동 · 도착까지 <b data-traffic-eta="${e(r.endsAt)}"></b></p><div data-traffic-individual><p>개별 이동을 불러오는 중…</p></div>`;
  this.tick();this.onSelect?.(r);detail.scrollIntoView({block:'nearest',behavior:'auto'});
 }
 showMovements(rows, nextCursor, error='') {
  const host=this.root.querySelector('[data-traffic-individual]');if(!host)return;
  host.innerHTML=rows.map((r,i)=>`<p class="traffic-individual">이동 ${i+1} <span>${r.status==='returning'?'귀환':'이동'} · <b data-traffic-eta="${e(r.endsAt)}"></b></span></p>`).join('')+(error?'<p class="detail-muted">이동 목록을 불러오지 못했습니다.</p>':'')+(nextCursor?'<button type="button" class="cmd-btn" data-traffic-more>더 보기</button>':''); this.tick();
 }
}
