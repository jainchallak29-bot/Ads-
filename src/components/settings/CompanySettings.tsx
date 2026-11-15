import { useState } from 'react';
import { Image, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { Button, Card, Field, H, Muted, Row } from '@/components/ui';
import { pickSmallImage } from '@/lib/images';
import type { Company, Project } from '@/lib/types';

/** Company details printed on receipts and shown on the customer page. */
export function CompanySettings({ project }: { project: Project }) {
  const { backend, toast } = useApp();
  const saved: Company = { name: '', address: '', phone: '', email: '', gstin: '', ...(project.company || {}) };
  const [draft, setDraft] = useState<Company | null>(null);
  const c = draft ?? saved;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (k: keyof Company) => (v: string) => setDraft({ ...c, [k]: v });

  return (
    <Card>
      <H>Company details</H>
      <Muted style={{ marginBottom: 10 }}>Printed on payment receipts and the customer page. All optional.</Muted>
      <Field label="Company name" value={c.name} onChangeText={set('name')} placeholder={project.name} testID="company-name" />
      <Field label="Address" value={c.address || ''} onChangeText={set('address')} multiline />
      <Field label="Phone" value={c.phone || ''} onChangeText={set('phone')} keyboardType="phone-pad" />
      <Field label="Email" value={c.email || ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
      <Field label="GSTIN" value={c.gstin || ''} onChangeText={set('gstin')} autoCapitalize="characters" />
      <Row style={{ marginBottom: 12 }}>
        {c.logo ? <Image source={{ uri: c.logo }} style={{ width: 64, height: 64, resizeMode: 'contain' }} accessibilityLabel="Company logo" /> : null}
        <Button
          small
          variant="secondary"
          icon="image-outline"
          title={c.logo ? 'Change logo' : 'Add logo'}
          onPress={async () => {
            try {
              const uri = await pickSmallImage();
              if (uri) setDraft({ ...c, logo: uri });
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        />
        {c.logo ? <Button small variant="ghost" title="Remove" onPress={() => setDraft({ ...c, logo: '' })} /> : null}
      </Row>
      <View>
        <Button
          small
          title="Save company details"
          disabled={!dirty}
          style={{ alignSelf: 'flex-start' }}
          onPress={() =>
            backend.updateProject(project.id, { company: c }).then(
              () => {
                setDraft(null);
                toast('Company details saved');
              },
              (e: Error) => toast(e.message),
            )
          }
          testID="company-save"
        />
      </View>
    </Card>
  );
}
