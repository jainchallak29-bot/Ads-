import { useApp } from '@/components/AppProvider';
import { Card, H, Muted, Toggle } from '@/components/ui';
import { features } from '@/lib/status';
import type { Features, Project } from '@/lib/types';

const ITEMS: { key: keyof Features; label: string; hint: string }[] = [
  { key: 'approval', label: 'Admin approval for bookings', hint: 'When Sales change a status it becomes a request until an Admin approves it.' },
  { key: 'pricing', label: 'Price list & premiums', hint: 'Base rate, block rates and premiums (corner, park facing…).' },
  { key: 'payments', label: 'Payments & receipts', hint: 'Instalment plans, payments received, overdue list and receipts. Admins only.' },
  { key: 'commission', label: 'Brokers & commission', hint: 'Which broker sold a plot and their commission. Admins only.' },
  { key: 'blocks', label: 'Blocks / phases', hint: 'Group plots into blocks and filter by block.' },
  { key: 'leads', label: 'Leads & site visits', hint: 'Enquiries, visits and follow-up reminders.' },
  { key: 'share', label: 'Customer share link', hint: 'A web link / QR code showing available plots to customers.' },
  { key: 'notifications', label: 'Notifications', hint: 'Alerts on phones when plots are booked or need approval.' },
  { key: 'files', label: 'Photos & documents', hint: 'Attach photos and PDFs to plots (needs Firebase Storage).' },
  { key: 'gps', label: 'GPS on site', hint: '"You are here" on the layout and directions to a plot.' },
];

/** Every feature can be switched off for a project. */
export function FeatureSettings({ project }: { project: Project }) {
  const { backend, toast } = useApp();
  const f = features(project);
  const set = (key: keyof Features, v: boolean) =>
    backend.updateProject(project.id, { features: { ...f, [key]: v } }).then(
      () => toast(`${ITEMS.find((i) => i.key === key)?.label} ${v ? 'on' : 'off'}`),
      (e: Error) => toast(e.message),
    );
  return (
    <Card>
      <H>Features</H>
      <Muted style={{ marginBottom: 6 }}>Turn off anything you don&apos;t need — it disappears for everyone in this project.</Muted>
      {ITEMS.map((i) => (
        <Toggle key={i.key} label={i.label} hint={i.hint} value={f[i.key]} onChange={(v) => set(i.key, v)} />
      ))}
    </Card>
  );
}
