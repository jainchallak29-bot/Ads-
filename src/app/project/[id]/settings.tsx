import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { FeatureSettings } from '@/components/settings/FeatureSettings';
import { StageSettings } from '@/components/settings/StageSettings';
import { Badge, Banner, Button, Card, Field, H, IconButton, Loading, Muted, Row, Screen, Segmented, Toggle, confirm } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { formatCode } from '@/lib/codes';
import { features } from '@/lib/status';
import { exportCsv, exportDxf, reportHtml } from '@/lib/export/exporters';
import { sharePdf, shareTextFile } from '@/lib/files';
import type { AreaUnit, DrawingUnit, LengthUnit, Member, ProjectCodes, Role } from '@/lib/types';
import { AREA_UNIT_LABEL, DRAWING_UNIT_LABEL } from '@/lib/units';
import { C } from '@/theme';

function CodeBox({ label, code, hint, onRegenerate, projectName }: { label: string; code: string; hint: string; onRegenerate: () => void; projectName: string }) {
  const { toast } = useApp();
  const pretty = formatCode(code);
  return (
    <View style={styles.codeBox}>
      <Text style={styles.codeLabel}>{label}</Text>
      <Text style={styles.code} selectable testID={`code-${label}`}>
        {pretty}
      </Text>
      <Muted style={{ fontSize: 12.5, marginBottom: 8 }}>{hint}</Muted>
      <Row style={{ flexWrap: 'wrap' }}>
        <Button
          small
          variant="secondary"
          icon="copy-outline"
          title="Copy"
          onPress={async () => {
            await Clipboard.setStringAsync(pretty);
            toast('Code copied');
          }}
        />
        <Button
          small
          variant="secondary"
          icon="share-social-outline"
          title="Share"
          onPress={() =>
            Share.share({ message: `Join "${projectName}" in the Plot Inventory app.\nOpen the app → Join with code → ${pretty}` }).catch(() => undefined)
          }
        />
        <Button small variant="ghost" icon="refresh" title="New code" onPress={onRegenerate} />
      </Row>
    </View>
  );
}

export default function Settings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend, uid, toast, forgetProject } = useApp();
  const { project, plots, layout, membership, loading, isAdmin } = useProject(id);
  const [codes, setCodes] = useState<ProjectCodes | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  // edited values; null = show the saved value
  const [nameDraft, setName] = useState<string | null>(null);
  const [locationDraft, setLocation] = useState<string | null>(null);
  const [currencyDraft, setCurrency] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const name = nameDraft ?? project?.name ?? '';
  const location = locationDraft ?? project?.location ?? '';
  const currency = currencyDraft ?? project?.currency ?? '';

  useEffect(() => {
    if (!isAdmin) return;
    backend.getCodes(id).then(setCodes, (e: Error) => toast(e.message));
  }, [backend, id, isAdmin, toast]);

  useEffect(() => {
    if (!membership) return;
    return backend.watchMembers(id, setMembers, () => undefined);
  }, [backend, id, membership]);

  if (loading || !project) return <Loading />;

  const update = (patch: Parameters<typeof backend.updateProject>[1], msg = 'Saved') =>
    backend.updateProject(id, patch).then(
      () => toast(msg),
      (e: Error) => toast(e.message),
    );

  const regenerate = async (role: Role) => {
    const ok = await confirm(
      'Make a new code?',
      `The current ${role === 'admin' ? 'Admin' : 'Sales'} code will stop working for new people. Phones that already joined keep access — remove them below if needed.`,
      'New code',
    );
    if (!ok) return;
    try {
      setCodes(await backend.regenerateCode(id, role));
      toast('New code created');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const exportAs = async (kind: 'dxf' | 'csv' | 'pdf') => {
    setBusy(kind);
    const base = project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project';
    const date = new Date().toISOString().slice(0, 10);
    try {
      if (kind === 'dxf') await shareTextFile(`${base}_${date}.dxf`, exportDxf(project, plots, layout), 'application/dxf');
      if (kind === 'csv') await shareTextFile(`${base}_inventory_${date}.csv`, exportCsv(project, plots), 'text/csv');
      if (kind === 'pdf') await sharePdf(`${base}_report_${date}.pdf`, reportHtml(project, plots, layout));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    if (!(await confirm('Leave project?', 'This phone will no longer see this project. You can join again with a code.', 'Leave', true))) return;
    await backend.leaveProject(id);
    await forgetProject(id);
    router.dismissAll();
    router.replace('/');
  };

  const del = async () => {
    if (!(await confirm('Delete project for everyone?', `"${project.name}" and all its plots will be deleted from every phone. This cannot be undone.`, 'Delete', true))) return;
    setBusy('delete');
    try {
      await backend.deleteProject(id);
      await forgetProject(id);
      router.dismissAll();
      router.replace('/');
    } catch (e) {
      toast((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Card>
        <H>Project</H>
        {isAdmin ? (
          <>
            <Field label="Name" value={name} onChangeText={setName} />
            <Field label="Location" value={location} onChangeText={setLocation} />
            <Button
              small
              title="Save"
              disabled={name.trim() === project.name && location.trim() === (project.location || '')}
              onPress={() => update({ name: name.trim() || project.name, location: location.trim() })}
              style={{ alignSelf: 'flex-start' }}
            />
          </>
        ) : (
          <>
            <Text style={styles.big}>{project.name}</Text>
            {project.location ? <Muted>{project.location}</Muted> : null}
          </>
        )}
        <View style={{ marginTop: 10 }}>
          <Badge text={membership?.role === 'admin' ? 'You are an Admin' : 'You joined with the Sales code'} color={membership?.role === 'admin' ? C.primary : '#7A5AF8'} soft />
        </View>
      </Card>

      {backend.kind === 'local' ? (
        <Banner tone="warn" text="This-phone-only mode: codes work only on this phone until Firebase is set up (see SETUP.md)." />
      ) : null}

      {isAdmin ? (
        <Card>
          <H>Share with your team</H>
          {codes ? (
            <>
              <CodeBox
                label="Sales code"
                code={codes.salesCode}
                projectName={project.name}
                hint="For sales staff / agents: see the layout and plot status."
                onRegenerate={() => regenerate('sales')}
              />
              <CodeBox
                label="Admin code"
                code={codes.adminCode}
                projectName={project.name}
                hint="Full control: edit plots, shapes, prices, codes. Share only with partners."
                onRegenerate={() => regenerate('admin')}
              />
            </>
          ) : (
            <Loading />
          )}
          <Toggle
            label="Sales team can mark plots booked / sold"
            hint="Also lets them add buyer name, phone, booking date and notes."
            value={project.salesCanEdit}
            onChange={(v) => update({ salesCanEdit: v }, v ? 'Sales team can now mark plots' : 'Sales team can only view now')}
          />
        </Card>
      ) : null}

      <Card>
        <H>Team ({members.length})</H>
        {members
          .sort((a, b) => a.joinedAt - b.joinedAt)
          .map((m) => (
            <View key={m.uid} style={styles.member}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: C.text }}>
                  {m.name || 'Unnamed'} {m.uid === uid ? <Text style={{ color: C.muted, fontWeight: '400' }}>(this phone)</Text> : null}
                </Text>
                <Muted style={{ fontSize: 12 }}>Joined {new Date(m.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Muted>
              </View>
              <Badge text={m.role === 'admin' ? 'Admin' : 'Sales'} color={m.role === 'admin' ? C.primary : '#7A5AF8'} soft />
              {isAdmin && m.uid !== uid ? (
                <IconButton
                  icon="person-remove-outline"
                  label={`Remove ${m.name}`}
                  color={C.danger}
                  onPress={async () => {
                    if (!(await confirm('Remove from project?', `${m.name || 'This person'} will lose access on their phone.`, 'Remove', true))) return;
                    backend.removeMember(id, m.uid).then(
                      () => toast('Removed'),
                      (e: Error) => toast(e.message),
                    );
                  }}
                />
              ) : null}
            </View>
          ))}
      </Card>

      <Card>
        <H>Export</H>
        <Muted style={{ marginBottom: 10 }}>Send the current inventory by WhatsApp / email or save it.</Muted>
        <View style={{ gap: 8 }}>
          <Button variant="secondary" icon="document-text-outline" title="PDF report (map + list)" loading={busy === 'pdf'} onPress={() => exportAs('pdf')} />
          <Button variant="secondary" icon="grid-outline" title="Excel sheet (CSV)" loading={busy === 'csv'} onPress={() => exportAs('csv')} />
          <Button variant="secondary" icon="layers-outline" title="CAD drawing (DXF) — plots coloured by status" loading={busy === 'dxf'} onPress={() => exportAs('dxf')} />
        </View>
      </Card>

      {isAdmin ? <FeatureSettings project={project} /> : null}
      {isAdmin ? <StageSettings project={project} /> : null}

      {features(project).pricing ? (
        <Card>
          <H>Price list</H>
          <Muted style={{ marginBottom: 10 }}>
            {project.pricing?.baseRate ? `Base rate ${project.currency}${project.pricing.baseRate.toLocaleString('en-IN')}` : 'No base rate yet'} · {project.pricing?.premiums?.length || 0} premiums
          </Muted>
          <Button variant="secondary" icon="pricetags-outline" title="Open price list" onPress={() => router.push({ pathname: '/project/[id]/pricing', params: { id } })} testID="open-pricing" />
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <H>Units</H>
          <Segmented
            label="Plot area"
            value={project.areaUnit}
            onChange={(v: AreaUnit) => update({ areaUnit: v })}
            options={(['sqyd', 'sqft', 'sqm'] as AreaUnit[]).map((u) => ({ value: u, label: AREA_UNIT_LABEL[u] }))}
          />
          <Segmented
            label="Plot sides"
            value={project.lengthUnit}
            onChange={(v: LengthUnit) => update({ lengthUnit: v })}
            options={[
              { value: 'ft', label: 'Feet' },
              { value: 'm', label: 'Metres' },
            ]}
          />
          <Segmented
            label="Drawing was made in"
            value={project.drawingUnit}
            onChange={(v: DrawingUnit) => update({ drawingUnit: v })}
            options={(['mm', 'cm', 'm', 'in', 'ft'] as DrawingUnit[]).map((u) => ({ value: u, label: u === 'in' ? 'inch' : u === 'ft' ? 'feet' : u }))}
          />
          <Muted style={{ fontSize: 12.5 }}>Currently: {DRAWING_UNIT_LABEL[project.drawingUnit]}. Change only if all plot areas look wrong.</Muted>
          <Field
            label="Currency symbol"
            value={currency}
            onChangeText={setCurrency}
            onEndEditing={() => currency.trim() && currency.trim() !== project.currency && update({ currency: currency.trim() })}
            onBlur={() => currency.trim() && currency.trim() !== project.currency && update({ currency: currency.trim() })}
            style={{ width: 90, marginTop: 10 }}
          />
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <H>Layout drawing</H>
          <Muted style={{ marginBottom: 10 }}>Load a revised DXF. Plots are matched by number, so their status and buyer details are kept.</Muted>
          <Button variant="secondary" icon="cloud-upload-outline" title="Update layout from new DXF" onPress={() => router.push({ pathname: '/import', params: { pid: id } })} />
        </Card>
      ) : null}

      <Card>
        <H>Leave or delete</H>
        <View style={{ gap: 8 }}>
          <Button variant="secondary" icon="exit-outline" title="Leave project on this phone" onPress={leave} />
          {isAdmin ? <Button variant="danger" icon="trash-outline" title="Delete project for everyone" loading={busy === 'delete'} onPress={del} /> : null}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeBox: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: '#FAFBFC' },
  codeLabel: { fontSize: 12, fontWeight: '700', color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  code: { fontSize: 28, fontWeight: '800', letterSpacing: 4, color: C.text, marginVertical: 4, fontVariant: ['tabular-nums'] },
  big: { fontSize: 18, fontWeight: '700', color: C.text },
  member: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
});
