import { router } from 'expo-router';
import { useState } from 'react';

import { useApp } from '@/components/AppProvider';
import { Banner, Button, Card, Field, H, Muted, Screen } from '@/components/ui';
import { formatCode, isValidCode, normalizeCode } from '@/lib/codes';

export default function Join() {
  const { backend, userName, rememberProject } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = (t: string) => {
    const c = normalizeCode(t).slice(0, 8);
    setCode(c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c);
    setError(null);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await backend.joinProject(code, { name: userName });
      await rememberProject({ id: r.projectId, name: r.name, role: r.role, joinedAt: Date.now() });
      router.replace({ pathname: '/project/[id]', params: { id: r.projectId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <H>Enter project code</H>
        <Muted style={{ marginBottom: 14 }}>
          Ask your project admin for the code. A Sales code lets you see the layout and plot status; an Admin code lets you edit everything.
        </Muted>
        <Field
          label="Project code"
          value={code}
          onChangeText={onChange}
          placeholder="ABCD-2345"
          autoCapitalize="characters"
          autoCorrect={false}
          style={{ fontSize: 24, letterSpacing: 3, textAlign: 'center', fontWeight: '700' }}
          testID="code-input"
        />
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button title={`Join ${isValidCode(code) ? formatCode(code) : ''}`} onPress={join} loading={busy} disabled={!isValidCode(code)} testID="join-submit" />
      </Card>
    </Screen>
  );
}
