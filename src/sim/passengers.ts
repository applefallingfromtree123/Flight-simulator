// Passengers: boarding at the gate, cabin announcements, and how they feel about the flight. Comfort drops with
// g-loads, steep bank or pitch, turbulence, hard landings and long waits, and slowly recovers in smooth air.
import type { Aircraft } from './fdm.ts';
import { FT, KT, RAD } from '../core/math.ts';

export type PaxPhase = 'boarding' | 'boarded' | 'taxi' | 'flight' | 'landed' | 'deboarding' | 'deboarded';

export class Passengers {
  boarded = 0;
  comfort = 100;           // 0..100
  phase: PaxPhase = 'boarding';
  notes: string[] = [];    // what bothered them (for the debrief)
  private noteSet = new Set<string>();
  private wasAirborne = false;
  private announced = new Set<string>();
  private waitT = 0;

  constructor(public count: number, atGate: boolean, private say: (ko: string) => void) {
    if (!atGate) { this.boarded = count; this.phase = 'flight'; }
  }

  private note(key: string, text: string, penalty: number) {
    this.comfort = Math.max(0, this.comfort - penalty);
    if (!this.noteSet.has(key)) { this.noteSet.add(key); this.notes.push(text); }
  }
  private announce(key: string, text: string) {
    if (this.announced.has(key)) return;
    this.announced.add(key);
    this.say(text);
  }

  /** Parked at the destination: doors open and the passengers leave (a bit quicker than boarding). */
  startDeboard() {
    if (this.phase !== 'landed') return;
    this.phase = 'deboarding';
    this.announce('deboard', '좌석벨트 표시등이 꺼졌습니다. 앞쪽 출입문부터 내리시겠습니다. 이용해 주셔서 감사합니다.');
  }

  /** Boarding takes about a minute for a full airliner (sped up). */
  get boardingDone() { return this.boarded >= this.count; }

  update(dt: number, ac: Aircraft, turb: number) {
    if (this.count <= 0) return;
    if (this.phase === 'boarding') {
      this.boarded = Math.min(this.count, this.boarded + dt * Math.max(3, this.count / 60));
      if (this.boardingDone) {
        this.phase = 'boarded';
        this.announce('boarded', `승객 ${this.count}명 탑승을 완료했습니다. 문을 닫겠습니다. 좌석벨트를 매 주십시오.`);
      }
      return;
    }
    if (this.phase === 'deboarding') {
      this.boarded = Math.max(0, this.boarded - dt * Math.max(4, this.count / 45));
      if (this.boarded <= 0) { this.phase = 'deboarded'; this.announce('deboarded', `승객 ${this.count}명이 모두 내렸습니다.`); }
      return;
    }
    if (this.phase === 'deboarded') return;
    const gs = ac.gs / KT;
    if (ac.onGround && !this.wasAirborne) {
      if (gs > 3 && this.phase === 'boarded') { this.phase = 'taxi'; this.announce('taxi', '승무원 여러분, 이륙 준비해 주십시오.'); }
      this.waitT += dt;
      if (this.waitT > 900) { this.note('wait', '출발 전 대기가 너무 길었습니다', dt * 0.02); }
    }
    if (!ac.onGround && ac.agl > 15) {
      if (!this.wasAirborne) { this.wasAirborne = true; this.phase = 'flight'; }
      const g = ac.nz;
      if (g > 1.45 || g < 0.55) this.note('g', '급격한 기동으로 몸이 쏠렸습니다', dt * (Math.abs(g - 1) - 0.35) * 25);
      if (g < 0.2) this.note('neg', '공중에 뜨는 느낌에 승객들이 비명을 질렀습니다', dt * 30);
      const bank = Math.abs(ac.phi * RAD), pitch = ac.theta * RAD;
      if (bank > 33) this.note('bank', '경사가 너무 깊었습니다', dt * (bank - 33) * 0.6);
      if (pitch > 22 || pitch < -12) this.note('pitch', '기수 각도가 과했습니다', dt * 3);
      if (turb > 0.35) { this.note('turb', '난기류로 기내가 크게 흔들렸습니다', dt * turb * 1.4); this.announce('turb' + Math.round(Date.now() / 600000), '난기류 구역을 지나고 있습니다. 좌석벨트를 매 주십시오.'); }
      if (ac.vs / FT * 60 < -3500 && ac.alt / FT < 20000) this.note('dive', '하강이 너무 급해 귀가 아팠습니다', dt * 2);
      if (turb < 0.12 && Math.abs(g - 1) < 0.15 && bank < 25) this.comfort = Math.min(100, this.comfort + dt * 0.02);
      if (ac.alt / FT > 10000) this.announce('cruise', '안전 고도에 도달했습니다. 좌석벨트 표시등이 꺼지면 기내를 이용하실 수 있습니다.');
    }
    if (this.wasAirborne && ac.onGround && this.phase === 'flight') {
      this.phase = 'landed';
      this.announce('landed', '저희 항공기는 목적지 공항에 도착했습니다. 항공기가 완전히 멈출 때까지 자리에서 기다려 주십시오.');
    }
  }

  /** Landing as the passengers felt it. */
  touchdown(fpm: number) {
    if (fpm > 600) this.note('hard', `하드 랜딩 (${Math.round(fpm)} fpm) — 짐칸이 열렸습니다`, 35);
    else if (fpm > 360) this.note('firm', `거친 착륙 (${Math.round(fpm)} fpm)`, 12);
    else if (fpm < 150) { this.comfort = Math.min(100, this.comfort + 6); this.notes.push(`부드러운 착륙에 박수가 나왔습니다 (${Math.round(fpm)} fpm)`); }
  }

  /** "92% · 만족" */
  get label() {
    const c = this.comfort;
    return `${Math.round(c)}% · ${c > 90 ? '매우 만족' : c > 75 ? '만족' : c > 55 ? '보통' : c > 35 ? '불만' : '분노'}`;
  }
}

/** Cabin and ATC voices (Web Speech; iPad Safari has Korean and English voices). */
export function speak(text: string, lang: 'ko-KR' | 'en-US', opts: { rate?: number; pitch?: number; voiceHint?: RegExp } = {}) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1;
    const voices = synth.getVoices().filter(v => v.lang.replace('_', '-').startsWith(lang.slice(0, 2)));
    const v = (opts.voiceHint && voices.find(x => opts.voiceHint!.test(x.name))) || voices[0];
    if (v) u.voice = v;
    synth.speak(u);
  } catch { /* no speech */ }
}
