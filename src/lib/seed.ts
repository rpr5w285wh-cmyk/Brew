import { db, PROFILE_ID, type Session, type Habit, type Settings, type TemplateRow, type Category } from './db';

// Curated from session-inventory.md (Yoga With Adriene only; IDs verified on yogawithadriene.com).
export const SESSIONS: Session[] = [
  { id: 'ywa-5min-morning', title: '5-Minute Morning Yoga', ytId: '4C-gxOE0j7s', titleMinutes: 5, tier: 0, category: 'wakeup', quiet: true, year: 2017, notes: 'Gentlest morning option. Feb 2017 Quickie.' },
  { id: 'ywa-take5', title: 'Take 5 Yoga Break', ytId: 'nQFf38xeBww', titleMinutes: 5, tier: 0, category: 'stretch', quiet: true, year: 2019, startPosition: 'all fours', notes: 'Breath, light core, full-body stretch.' },
  { id: 'ywa-5min-fullbody', title: '5 Minute Full Body Stretch', ytId: 'Kvoq4luIYVc', titleMinutes: 5, tier: 0, category: 'stretch', quiet: true, year: 2023, notes: 'Brisk, no fluff.' },
  { id: 'ywa-juices', title: 'Yoga To Get the Juices Flowing', ytId: 'JOilkvadChg', titleMinutes: 6, tier: 0, category: 'energy', quiet: true, year: 2015, notes: 'Her original quickie for busy mornings.' },
  { id: 'ywa-7min-boost', title: '7-Minute Yoga Boost', ytId: '3Ql411IIpJM', titleMinutes: 7, tier: 0, category: 'energy', quiet: true, year: 2017, notes: 'Some leg work at the end.' },
  { id: 'ywa-7min-runners', title: '7-Minute Yoga For Runners', ytId: 'RGOrpTLiaec', titleMinutes: 7, tier: 0, category: 'stretch', quiet: true, year: 2017, notes: 'Full-body stretch; good on walk days.' },
  { id: 'ywa-7min-stress', title: 'Yoga For Stress Relief (7 min)', ytId: 'qiKJRoX_2uo', titleMinutes: 7, tier: 0, category: 'energy', quiet: true, year: 2016, startPosition: 'standing', notes: 'Hatha/Kundalini blend with arm swinging.' },
  { id: 'ywa-10min-morning', title: '10-Minute Morning Yoga', ytId: 'klmBssEYkdU', titleMinutes: 10, tier: 0, category: 'wakeup', quiet: true, year: 2022, notes: 'Her flagship short morning practice.' },
  { id: 'ywa-10min-fullbody', title: '10 Minute Full Body Stretch', ytId: 'lxuTCHJSers', titleMinutes: 10, tier: 0, category: 'stretch', quiet: true, year: 2024, startPosition: 'all fours', notes: 'Foot to crown.' },
  { id: 'ywa-10min-beginners', title: '10 Min Yoga for Beginners', ytId: 'j7rKKpwdXNE', titleMinutes: 10, tier: 0, category: 'basics', quiet: true, year: 2022, notes: 'Basics re-entry, not remedial.' },
  { id: 'ywa-10min-selfcare', title: '10-Minute Yoga For Self Care', ytId: 'VpW33Celubg', titleMinutes: 10, tier: 0, category: 'restorative', quiet: true, year: 2017, notes: 'Gentle poses, breath, self-massage.' },
  { id: 'ywa-focus', title: 'Yoga for Focus and Productivity', ytId: 'Nnd5Slo02us', titleMinutes: 10, tier: 0, category: 'basics', quiet: true, year: 2016, notes: 'Circulation + breath.' },
  { id: 'ywa-neck', title: 'Yoga For Neck, Shoulders, Upper Back', ytId: 'X3-gKPNyrTA', titleMinutes: 10, tier: 0, category: 'restorative', quiet: true, year: 2019, notes: 'Runs 10:38. Desk-worker relief.' },
  // breath / meditation
  { id: 'ywa-calming-breath', title: '5 Minute Calming Breathwork', ytId: '9fEo9my03Ks', titleMinutes: 5, tier: 0, category: 'breath', quiet: true, year: 2023, notes: 'Can be done lying down. Get-out-of-bed option.' },
  { id: 'ywa-7min-meditation', title: '7 Minute Meditation to Start Your Day', ytId: 'k0PSUDvLi8E', titleMinutes: 7, tier: 0, category: 'breath', quiet: true, year: 2018, notes: 'Seated.' },
  { id: 'ywa-8min-anywhere', title: '8 Minute Meditation You Can Do Anywhere', ytId: 'p8oxM5j9eNE', titleMinutes: 8, tier: 0, category: 'breath', quiet: true, year: 2022, notes: 'Seated, chair, bed or car.' },
  // evening
  { id: 'ywa-7min-bedtime', title: '7-Minute Bedtime Yoga', ytId: 'LI9upn4t9n8', titleMinutes: 7, tier: 0, category: 'bedtime', quiet: true, year: 2017, notes: 'Floor-based wind-down.' },
];

export const HABITS: Habit[] = [
  { id: 'h-teeth-am', profileId: PROFILE_ID, key: 'teeth_am', name: 'Teeth', floorText: 'Brush.', slot: 'morning', order: 10, active: true, offRoutine: 'same' },
  { id: 'h-shower', profileId: PROFILE_ID, key: 'shower', name: 'Shower', floorText: 'Any time today counts on an off day.', slot: 'morning', order: 20, active: true, offRoutine: 'same' },
  { id: 'h-outside', profileId: PROFILE_ID, key: 'outside', name: 'Outside', floorText: 'Two minutes on the front step counts.', slot: 'day', order: 10, active: true, offRoutine: 'floor' },
  { id: 'h-kitchen', profileId: PROFILE_ID, key: 'kitchen_closed', name: 'Kitchen closed after 20:00', floorText: '—', slot: 'evening', order: 5, active: false, offRoutine: 'same' },
  { id: 'h-teeth-pm', profileId: PROFILE_ID, key: 'teeth_pm', name: 'Teeth', floorText: 'Brush.', slot: 'evening', order: 10, active: true, offRoutine: 'same' },
  { id: 'h-weigh', profileId: PROFILE_ID, key: 'weigh', name: 'Weigh-in', floorText: 'Skip if no scale; the trend tolerates gaps.', slot: 'weekly', order: 10, active: true, offRoutine: 'skip' },
];

export const DEFAULT_SETTINGS: Settings = {
  profileId: PROFILE_ID,
  wakeTarget: '06:30',
  bedtimeHypothesis: '22:45',
  windDownLeadMin: 45,
  waterTarget: 6,
  waterFloor: 3,
  tier: 0,
  noRepeatDays: 14,
  kitchenClosedEnabled: false, // legacy; the habit's `active` flag is the source of truth
  dayBoundary: '03:00',
  breathingUrl: 'https://rpr5w285wh-cmyk.github.io/Zazen/breathe.html',
  weighDay: 0,
  theme: 'dark',
};

// weekday: 0 = Sunday … 6 = Saturday
export const DEFAULT_TEMPLATE: TemplateRow[] = [
  { profileId: PROFILE_ID, weekday: 1, category: 'wakeup' },
  { profileId: PROFILE_ID, weekday: 2, category: 'stretch' },
  { profileId: PROFILE_ID, weekday: 3, category: 'basics' },
  { profileId: PROFILE_ID, weekday: 4, category: 'restorative' },
  { profileId: PROFILE_ID, weekday: 5, category: 'energy' },
  { profileId: PROFILE_ID, weekday: 6, category: 'stretch' },
  { profileId: PROFILE_ID, weekday: 0, category: 'breath' },
];

export const CATEGORY_LABEL: Record<Category, string> = {
  wakeup: 'Wake-up',
  stretch: 'Full-body stretch',
  basics: 'Basics / focus',
  restorative: 'Restorative / upper body',
  energy: 'Energy',
  breath: 'Breath only',
  bedtime: 'Bedtime',
};

export const FALLBACKS: { key: string; title: string; text: string }[] = [
  { key: 'spine', title: 'A. Spine wake-up (floor)', text: 'Cat-cow × 8 slow breaths. Child\'s pose, 5 breaths. Low lunge, 5 breaths each side. Standing forward fold, 5 breaths. Roll up.' },
  { key: 'sun', title: 'B. Three slow sun salutations', text: 'Mountain → arms up → fold → half-lift → step back to plank → lower → cobra → down dog, 5 breaths → step forward → half-lift → fold → rise. Three rounds, no rush.' },
  { key: 'standing', title: 'C. Standing, no mat', text: 'Shoulder rolls × 10. Side bend, 3 breaths each side. Forward fold, hang, 5 breaths. Ten slow breaths standing, eyes closed.' },
];

let synced = false;
export async function ensureSeeded(): Promise<void> {
  const existing = await db.profiles.get(PROFILE_ID);
  if (existing) {
    // Keep the library current once per app start. Merge, never replace: user-side
    // fields such as measuredSeconds survive.
    if (synced) return;
    synced = true;
    await db.transaction('rw', db.sessions, async () => {
      for (const s of SESSIONS) {
        const cur = await db.sessions.get(s.id);
        await db.sessions.put(cur ? { ...s, measuredSeconds: cur.measuredSeconds } : s);
      }
    });
    return;
  }
  synced = true;
  await db.transaction('rw', db.profiles, db.settings, db.habits, db.sessions, db.template, async () => {
    await db.profiles.put({ id: PROFILE_ID, name: 'MDF', createdAt: Date.now() });
    await db.settings.put(DEFAULT_SETTINGS);
    await db.habits.bulkPut(HABITS);
    await db.sessions.bulkPut(SESSIONS);
    await db.template.bulkPut(DEFAULT_TEMPLATE);
  });
}
