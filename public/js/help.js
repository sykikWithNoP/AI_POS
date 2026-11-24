// "?" help panel: short, plain-language steps for the page you are on, with a link into the full guide.
import { h, icon } from './ui.js';
import { current } from './router.js';

const G = (anchor) => `/guide#${anchor}`;

const HELP = {
  'pos/sell': { title: 'Selling', guide: G('6-a-normal-day'), steps: [
    'Tap a product, type its name in the search box (F2), or scan its barcode.',
    'Optional: find the customer in the box at the top right (F3). Members get their discount automatically.',
    'Press Charge (F9), choose how they pay and finish. Print the receipt or show the bill QR.',
    'Serving someone else meanwhile? Click "+ New" above the bill. Open bills are kept even if the computer restarts.',
    'Start the day with "Open shift" (top right) and end it with "Close shift" to count the cash.',
  ], tour: true },
  'pos/items': { title: 'Your products', guide: G('7-your-products-pos-items'), steps: [
    '"Add item": a name and a price are enough. Add a barcode, cost and stock if you want stock tracking and profit reports.',
    'Sizes or extras (Large, Extra cheese…) go in the item\'s options.',
    'Supplies arrived? Use "Stock in" at the top. "Stock history" shows every change.',
    'Moving from another system? Settings › Data › "Move from another system".',
  ] },
  'pos/customers': { title: 'Customers', guide: G('8-customers-memberships-and-points'), steps: [
    'Add regular customers with phone and PAN (needed on tax bills).',
    'Open a customer to start a sale for them, see their bills, points and membership.',
    'Sell a membership from the Sell screen with the "★ Membership" button (bottom left).',
  ] },
  'overview/dashboard': { title: 'Dashboard', guide: G('9-seeing-how-youre-doing-overview'), steps: [
    'The three tiles at the top show Today, This month and This year. Click one to switch.',
    'Use ◀ ▶ to look at earlier days, months or years.',
    '"Export CSV" downloads the period\'s bills for your accountant.',
  ] },
  'overview/bills': { title: 'Bills', guide: G('refunds-and-cancelling'), steps: [
    'Search by bill number, customer, phone or PAN. Filter by Paid, Pending, Pay later or Void.',
    'Click a bill to reprint it, copy its link, refund items or cancel (void) it.',
    'Pay-later customers: choose "Pay later (due)", open their bill and press "Collect payment".',
  ] },
  'overview/reports': { title: 'Reports', guide: G('9-seeing-how-youre-doing-overview'), steps: [
    'Pick a report, set the period and download it as CSV (opens in Excel).',
    'The sales register and VAT summary are what your accountant needs for VAT returns.',
  ] },
  'overview/ird': { title: 'IRD', guide: G('10-connecting-things-connectors'), steps: [
    'Press "Set up IRD" and follow the steps. It starts in practice mode: nothing is sent.',
    'Turn practice mode off only after your accountant confirms your CBMS login.',
    'The filing pack collects everything for the fiscal year in one file.',
  ] },
  'connectors/payments': { title: 'Payments', guide: G('10-connecting-things-connectors'), steps: [
    'Each card has numbered steps. Fill them in, press Save, then Test.',
    'Do one small real sale (e.g. Rs 10) — the card gets a green tick once a real payment is confirmed.',
    'Saved keys are hidden for good. To change one, type a new one.',
  ] },
  'connectors/tax': { title: 'Tax & IRD', guide: G('10-connecting-things-connectors'), steps: ['Easiest: Overview › IRD › "Set up IRD" walks you through this card.'] },
  'connectors/apps': { title: 'Apps & AI', guide: G('10-connecting-things-connectors'), steps: [
    'Google Calendar: shows deliveries and reminders on the Dashboard.',
    'Telegram: a message on your phone for every sale.',
    'AI Copilot: add your own Anthropic key; the assistant asks before changing anything.',
  ] },
  'connectors/devices': { title: 'Printer & scanner', guide: G('14-help-somethings-wrong'), steps: [
    'Printer: choose how it is connected, then press "Test print".',
    'Network printers: type the printer\'s IP address (printed on its self-test page).',
    'USB barcode scanners work without setup: scan on the Sell screen.',
  ] },
  'connectors/developer': { title: 'Developer', guide: G('10-connecting-things-connectors'), steps: ['For your own scripts and websites. If you don\'t know what this is, you don\'t need it.'] },
  'settings/business': { title: 'Business & tax', guide: G('4-the-first-time-you-open-it'), steps: ['Shop details are printed on every bill. Tax rate and "prices include tax" change how totals are worked out.'] },
  'settings/appearance': { title: 'Appearance', guide: G('5-finding-your-way-around'), steps: ['Pick one of the themes or make your own from a photo. "Touch mode" makes buttons bigger for touch screens.'] },
  'settings/selling': { title: 'Checkout', guide: G('pay-later'), steps: ['Turn pay later on or off, set the most staff can discount without the PIN, loyalty points and shifts.'] },
  'settings/memberships': { title: 'Memberships', guide: G('8-customers-memberships-and-points'), steps: ['Create tiers (e.g. Silver 5%, Gold 10%) with a price and length. Choose the tier new customers get.'] },
  'settings/security': { title: 'Security', guide: G('14-help-somethings-wrong'), steps: ['Change the PIN, replace the Owner Key, and see the tamper check. Keep the Owner Key printed and away from this computer.'] },
  'settings/extensions': { title: 'Extensions', guide: G('5-finding-your-way-around'), steps: ['Add small features of your own, or describe one and let the AI write it. Extensions can never change prices on their own.'] },
  'settings/data': { title: 'Data & backups', guide: G('11-keeping-your-data-safe'), steps: [
    'A backup is made every day. Once a week, plug in a USB stick and press "Back up to USB".',
    'To restore, choose a backup — your current data is saved first.',
  ] },
  'settings/updates': { title: 'Updates', guide: G('12-updates'), steps: ['Install a .posupdate file, or turn on update checks. Your data is backed up first and a broken update rolls back by itself.'] },
};

export function toggleHelp() {
  const open = document.querySelector('.help-panel');
  if (open) { open.remove(); return; }
  const { page, sub } = current();
  const info = HELP[`${page.id}/${sub?.id}`] || { title: page.title, steps: ['Use the tabs at the top to move between sections.'], guide: '/guide' };
  const panel = h('aside.help-panel', { role: 'dialog', 'aria-label': `Help: ${info.title}` },
    h('header', h('h3', icon('bell', 18), info.title), h('button.icon-btn', { 'aria-label': 'Close help', onclick: () => panel.remove() }, icon('x'))),
    h('ol', info.steps.map((s) => h('li', s))),
    h('div.row-actions',
      info.tour ? h('button.btn', { onclick: async () => { panel.remove(); (await import('./welcome.js')).sellTour(); } }, icon('sparkles', 16), 'Show me around') : null,
      h('a.btn.primary', { href: info.guide || '/guide', target: '_blank', rel: 'noopener' }, 'Open the full guide')),
    h('p.muted', 'Keys: F2 search · F3 customer · F9 charge · Alt+1–4 pages · Alt+[ ] tabs · Esc close'));
  document.body.append(panel);
  const away = (e) => { if (!panel.contains(e.target) && !e.target.closest('.help-btn')) { panel.remove(); document.removeEventListener('mousedown', away); } };
  setTimeout(() => document.addEventListener('mousedown', away), 0);
}
