import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from '@/components/AppProvider';
import { C } from '@/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#fff' },
            headerTintColor: C.text,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: C.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="index" options={{ title: 'My Projects' }} />
          <Stack.Screen name="join" options={{ title: 'Join a project' }} />
          <Stack.Screen name="import" options={{ title: 'Import layout (DXF)' }} />
          <Stack.Screen name="project/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="project/[id]/plot/[plotId]" options={{ title: 'Plot details' }} />
          <Stack.Screen name="project/[id]/list" options={{ title: 'All plots' }} />
          <Stack.Screen name="project/[id]/settings" options={{ title: 'Project settings' }} />
          <Stack.Screen name="project/[id]/pricing" options={{ title: 'Price list' }} />
          <Stack.Screen name="project/[id]/menu" options={{ title: 'Menu' }} />
          <Stack.Screen name="project/[id]/dashboard" options={{ title: 'Dashboard' }} />
          <Stack.Screen name="project/[id]/requests" options={{ title: 'Approvals' }} />
          <Stack.Screen name="project/[id]/collections" options={{ title: 'Collections' }} />
          <Stack.Screen name="project/[id]/brokers" options={{ title: 'Brokers & commission' }} />
          <Stack.Screen name="project/[id]/accounts/[plotId]" options={{ title: 'Payments' }} />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
