// Airline management screen: found the airline, buy/lease aircraft, open routes, run days, fly a route.
import type { AirportDB } from '../world/airports.ts';
import { getAircraft } from '../sim/aircraftDb.ts';
import { distance } from '../core/geo.ts';
import type { FlightConfig } from './menu.ts';
import {
  hangarCost, hubCost, leaseOutRate, resaleValue, returnFee, servedByHangar,
  canFly, flightEconomics, loadAirline, market, maxPerDay, newAirline, refFare, registration, runDay, saveAirline,
} from '../career/airline.ts';

const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;

export function renderAirline(el: HTMLElement, db: AirportDB, fly: (c: Partial<FlightConfig>, routeId: string, pax: number) => void) {
  const al = loadAirline();
  if (!al) {
    el.innerHTML = `
      <div class="sec"><h3>항공사 설립</h3>
        <p class="note">허브 공항에서 시작 자금 $60,000,000으로 항공사를 세웁니다. 비행기를 사거나 리스하고, 실제 공항 사이에 노선을 열어
        운임과 운항 횟수를 정하세요. "다음 날" 을 누르면 승객 수요·운임·평판에 따라 하루의 수익과 비용이 계산됩니다. 노선을 직접 비행할 수도 있습니다.</p>
        <div class="field"><label>항공사 이름</label><input id="alName" placeholder="예: 하늘항공" value=""></div>
        <div class="frow"><div class="field"><label>호출부호 코드 (2~3자)</label><input id="alCode" placeholder="SKY" value="SKY"></div>
        <div class="field"><label>허브 공항</label><input id="alHub" value="RKSI"></div></div>
        <button id="alStart" class="primary" style="width:100%">항공사 설립</button>
      </div>`;
    el.querySelector<HTMLButtonElement>('#alStart')!.onclick = () => {
      const name = el.querySelector<HTMLInputElement>('#alName')!.value.trim() || '하늘항공';
      const hub = db.get(el.querySelector<HTMLInputElement>('#alHub')!.value.trim());
      if (!hub) { alert('허브 공항을 찾을 수 없습니다.'); return; }
      saveAirline(newAirline(name, el.querySelector<HTMLInputElement>('#alCode')!.value.trim() || 'SKY', hub.icao));
      renderAirline(el, db, fly);
    };
    return;
  }
  const save = () => { saveAirline(al); renderAirline(el, db, fly); };
  const mk = market();
  const planeName = (id: string) => { const p = al.fleet.find(x => x.id === id); return p ? `${p.reg} ${getAircraft(p.type).name}` : '—'; };
  const routesHtml = al.routes.map(r => {
    const a = db.get(r.from), b = db.get(r.to);
    const d = a && b ? distance(a, b) / 1000 : 0;
    return `<div class="job"><div class="job-h"><b>${r.from} ⇄ ${r.to}</b><span class="dim">${Math.round(d).toLocaleString()} km</span></div>
      <div class="dim">${planeName(r.planeId)} · 하루 ${r.perDay}회 왕복 · 운임 $${r.fare} (기준 $${refFare(d)})</div>
      <div class="frow"><button data-fly="${r.id}" class="primary">직접 운항 ✈</button><button data-fare="${r.id}">운임 변경</button><button data-del="${r.id}">노선 폐지</button></div></div>`;
  }).join('') || '<p class="note">아직 노선이 없습니다. 비행기를 먼저 확보한 뒤 노선을 여세요.</p>';
  const hubs = al.hubs ?? [al.hub], hangars = al.hangars ?? [];
  const mxCost = (p: typeof al.fleet[number]) => Math.round((100 - p.condition) * 9000 * (servedByHangar(al, p) ? 0.5 : 1));
  const fleetHtml = al.fleet.map(p => {
    const used = al.routes.find(r => r.planeId === p.id);
    const state = p.leasedOut ? `다른 항공사에 임대 중 (+${usd(p.leasedOut.perDay)}/일)` : used ? `${used.from}–${used.to}` : '대기';
    const acts = p.leasedOut
      ? `<button data-recall="${p.id}">임대 회수</button>`
      : used ? '' : p.owned
        ? `<button data-sell="${p.id}">판매 ${usd(resaleValue(p))}</button><button data-lout="${p.id}">임대 내보내기 ${usd(leaseOutRate(p))}/일</button>`
        : `<button data-return="${p.id}">리스 반납 (위약금 ${usd(returnFee(p))})</button>`;
    return `<div class="fl-row"><b>${p.reg}</b> ${getAircraft(p.type).name} <span class="dim">${p.owned ? '소유' : '리스'} · ${Math.round(p.hours)}h · 상태 ${Math.round(p.condition)}%${servedByHangar(al, p) ? ' 🔧' : ''} · ${state}</span>
      ${p.condition < 70 && !p.leasedOut ? `<button data-mx="${p.id}">정비 ${usd(mxCost(p))}</button>` : ''}${acts}</div>`;
  }).join('') || '<p class="note">보유 기체가 없습니다.</p>';
  const hubsHtml = hubs.map((h, i) => { const a = db.get(h); return `<div class="fl-row"><b>${h}</b> <span class="dim">${a?.name ?? ''} · ${i === 0 ? '주 허브' : `제${i + 1} 허브`} · 유지비 ${a ? usd(hubCost(a).perDay) : ''}/일</span>
    ${i > 0 ? `<button data-unhub="${h}">허브 폐쇄</button>` : ''}</div>`; }).join('');
  const hangarHtml = hangars.map(h => { const a = db.get(h.icao); return `<div class="fl-row"><b>🔧 ${h.icao}</b> <span class="dim">${a?.name ?? ''} · ${a?.country ?? ''} · 유지비 ${a ? usd(hangarCost(a).perDay) : ''}/일</span>
    <button data-unhangar="${h.icao}">철거</button></div>`; }).join('') || '<p class="note">아직 격납고가 없습니다.</p>';
  const last = al.last;
  el.innerHTML = `
    <div class="sec pilot">
      <div class="job-h"><b>${al.name} (${al.code})</b><span class="dim">허브 ${hubs.join(' · ')} · ${al.day}일차</span></div>
      <div class="frow"><button id="alRename">✏️ 이름·코드 변경</button></div>
      <div class="spec-grid"><div><span>자금</span>${usd(al.cash)}</div><div><span>평판</span>${Math.round(al.rep)}/100</div>
        <div><span>기단</span>${al.fleet.length}대</div><div><span>노선</span>${al.routes.length}개</div></div>
      <button id="alDay" class="primary" style="width:100%">다음 날 진행 ▶</button>
      ${last ? `<div class="dim" style="font-size:12px">${last.day}일차 결과: 승객 ${last.lines.reduce((s, l) => s + l.pax, 0).toLocaleString()}명 · 매출 ${usd(last.revenue)} · 비용 ${usd(last.cost + last.leases)} · <b style="color:${last.profit >= 0 ? 'var(--ok)' : 'var(--err)'}">${usd(last.profit)}</b>
        ${last.events.map(e => `<br>⚠ ${e}`).join('')}</div>` : ''}
    </div>
    <div class="sec"><h3>노선</h3>${routesHtml}
      <div class="r-add r-add4"><select id="rFrom">${hubs.map(h => `<option value="${h}">${h} 출발</option>`).join('')}</select><input id="rTo" placeholder="도착 (ICAO)"><select id="rPlane">${al.fleet.filter(p => !p.leasedOut && !al.routes.some(r => r.planeId === p.id)).map(p => `<option value="${p.id}">${p.reg} ${getAircraft(p.type).name}</option>`).join('') || '<option value="">빈 기체 없음</option>'}</select>
      <button id="rAdd">노선 개설</button></div>
      <p class="note">노선은 허브에서 출발합니다. 운임을 기준가보다 낮추면 승객이 늘고, 높이면 줄어듭니다.</p></div>
    <div class="sec"><h3>허브</h3>${hubsHtml}
      <div class="r-add"><input id="hubNew" placeholder="새 허브 공항 (ICAO)"><button id="hubAdd">허브 개설</button></div>
      <p class="note">개설비: 대형 공항 ${usd(18e6)} · 중형 ${usd(6e6)} · 소형 ${usd(1.5e6)}. 허브마다 노선을 출발시킬 수 있습니다.</p></div>
    <div class="sec"><h3>격납고 (전 세계)</h3>${hangarHtml}
      <div class="r-add"><input id="hgNew" placeholder="공항 (ICAO · 어디든)"><button id="hgAdd">격납고 건설</button></div>
      <p class="note">격납고 공항을 오가는 기체(🔧)는 매일 상태가 회복되고, 정비비가 절반, 운항 정비비가 30% 줄어듭니다.</p></div>
    <div class="sec"><h3>기단</h3>${fleetHtml}</div>
    <div class="sec"><h3>기체 시장</h3><div class="mk-list">${mk.map((m, i) => `<div class="fl-row"><b>${m.def.mfr} ${m.def.name}</b> <span class="dim">${m.seats}석 · 구매 ${usd(m.price)} · 리스 ${usd(m.leasePerDay)}/일</span>
      <button data-buy="${i}">구매</button><button data-lease="${i}">리스</button></div>`).join('')}</div></div>
    <button id="alReset" style="width:100%;opacity:.7">항공사 초기화</button>`;
  const $ = (s: string) => el.querySelector<HTMLElement>(s)!;
  $('#alDay').onclick = () => { runDay(al, db); save(); };
  $('#alRename').onclick = () => {
    const n = prompt('항공사 이름', al.name);
    if (n === null) return;
    const c = prompt('호출부호 코드 (2~3자, 영문)', al.code);
    if (n.trim()) al.name = n.trim();
    if (c && /^[A-Za-z0-9]{2,3}$/.test(c.trim())) al.code = c.trim().toUpperCase();
    save();
  };
  const plane = (id?: string) => al.fleet.find(x => x.id === id)!;
  el.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach(b => b.onclick = () => {
    const p = plane(b.dataset.sell), v = resaleValue(p);
    if (!confirm(`${p.reg}을(를) ${usd(v)}에 판매할까요?`)) return;
    al.cash += v; al.fleet = al.fleet.filter(x => x !== p); save();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-lout]').forEach(b => b.onclick = () => {
    const p = plane(b.dataset.lout);
    p.leasedOut = { perDay: leaseOutRate(p), since: al.day }; save();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-recall]').forEach(b => b.onclick = () => { delete plane(b.dataset.recall).leasedOut; save(); });
  el.querySelectorAll<HTMLButtonElement>('[data-return]').forEach(b => b.onclick = () => {
    const p = plane(b.dataset.return), fee = returnFee(p);
    if (!confirm(`${p.reg} 리스를 반납할까요? 위약금 ${usd(fee)}`)) return;
    al.cash -= fee; al.fleet = al.fleet.filter(x => x !== p); save();
  });
  $('#hubAdd').onclick = () => {
    const a = db.get(($('#hubNew') as HTMLInputElement).value.trim());
    if (!a) { alert('공항을 찾을 수 없습니다.'); return; }
    if (hubs.includes(a.icao)) { alert('이미 허브입니다.'); return; }
    const c = hubCost(a);
    if (al.cash < c.open) { alert(`자금이 부족합니다 (${usd(c.open)} 필요)`); return; }
    if (!confirm(`${a.icao} ${a.name}에 제${hubs.length + 1} 허브를 개설할까요? ${usd(c.open)} · 유지비 ${usd(c.perDay)}/일`)) return;
    al.cash -= c.open; al.hubs = [...hubs, a.icao]; save();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-unhub]').forEach(b => b.onclick = () => {
    const h = b.dataset.unhub!;
    if (al.routes.some(r => r.from === h)) { alert('이 허브에서 출발하는 노선을 먼저 폐지하세요.'); return; }
    al.hubs = hubs.filter(x => x !== h); save();
  });
  $('#hgAdd').onclick = () => {
    const a = db.get(($('#hgNew') as HTMLInputElement).value.trim());
    if (!a) { alert('공항을 찾을 수 없습니다.'); return; }
    if (hangars.some(h => h.icao === a.icao)) { alert('이미 격납고가 있습니다.'); return; }
    const c = hangarCost(a);
    if (al.cash < c.build) { alert(`자금이 부족합니다 (${usd(c.build)} 필요)`); return; }
    if (!confirm(`${a.icao} ${a.name} (${a.country})에 격납고를 지을까요? ${usd(c.build)} · 유지비 ${usd(c.perDay)}/일`)) return;
    al.cash -= c.build; al.hangars = [...hangars, { icao: a.icao, since: al.day }]; save();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-unhangar]').forEach(b => b.onclick = () => {
    if (!confirm('격납고를 철거할까요? (건설비는 돌려받지 못합니다)')) return;
    al.hangars = hangars.filter(h => h.icao !== b.dataset.unhangar); save();
  });
  $('#alReset').onclick = () => { if (confirm('항공사를 처음부터 다시 시작할까요?')) { saveAirline(null); renderAirline(el, db, fly); } };
  el.querySelectorAll<HTMLButtonElement>('[data-buy],[data-lease]').forEach(b => b.onclick = () => {
    const m = mk[+(b.dataset.buy ?? b.dataset.lease!)], buy = b.dataset.buy !== undefined;
    const cost = buy ? m.price : m.leasePerDay * 30;  // leases start with a month's deposit
    if (al.cash < cost) { alert(`자금이 부족합니다 (${usd(cost)} 필요)`); return; }
    al.cash -= cost;
    al.fleet.push({ id: `P${Date.now().toString(36)}`, type: m.def.id, reg: registration(al), owned: buy, base: al.hub, hours: 0, condition: 100 });
    save();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-mx]').forEach(b => b.onclick = () => {
    const p = al.fleet.find(x => x.id === b.dataset.mx)!, cost = mxCost(p);
    if (al.cash < cost) { alert('자금이 부족합니다'); return; }
    al.cash -= cost; p.condition = 100; save();
  });
  $('#rAdd').onclick = () => {
    const to = db.get(($('#rTo') as HTMLInputElement).value.trim()), hub = db.get(($('#rFrom') as HTMLSelectElement).value)!;
    const planeId = ($('#rPlane') as HTMLSelectElement).value;
    if (!to || to === hub) { alert('도착 공항을 확인하세요.'); return; }
    const p = al.fleet.find(x => x.id === planeId);
    if (!p) { alert('노선에 투입할 빈 기체가 없습니다. 기체를 사거나 리스하세요.'); return; }
    const def = getAircraft(p.type), why = canFly(def, hub, to);
    if (why) { alert(why); return; }
    const d = distance(hub, to) / 1000;
    al.routes.push({ id: `R${Date.now().toString(36)}`, from: hub.icao, to: to.icao, planeId, perDay: maxPerDay(def, d * 2) || 1, fare: refFare(d) });
    save();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-del]').forEach(b => b.onclick = () => { al.routes = al.routes.filter(r => r.id !== b.dataset.del); save(); });
  el.querySelectorAll<HTMLButtonElement>('[data-fare]').forEach(b => b.onclick = () => {
    const r = al.routes.find(x => x.id === b.dataset.fare)!;
    const v = prompt('편도 운임 (USD)', String(r.fare));
    if (v && +v > 0) { r.fare = Math.round(+v); save(); }
  });
  el.querySelectorAll<HTMLButtonElement>('[data-fly]').forEach(b => b.onclick = () => {
    const r = al.routes.find(x => x.id === b.dataset.fly)!, p = al.fleet.find(x => x.id === r.planeId)!;
    const e = flightEconomics(al, r, db);
    const def = getAircraft(p.type);
    al.flightNo = al.flightNo >= 999 ? 101 : al.flightNo + 1;
    saveAirline(al);
    fly({ aircraftId: def.id, dep: r.from, arr: r.to, depRwy: '', arrRwy: '', route: '', start: 'gate', gate: undefined,
      payloadPct: Math.round(Math.min(100, e.pax * 95 / Math.max(1, def.m.pay) * 100)), fuelPct: 70 }, r.id, e.pax);
  });
}
