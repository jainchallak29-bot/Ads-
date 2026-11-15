// Things this phone remembers: the user's name and which projects it has joined.
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { JoinedProject } from './types';

const NAME_KEY = 'user-name';
const PROJECTS_KEY = 'joined-projects';

export async function loadUserName(): Promise<string> {
  return (await AsyncStorage.getItem(NAME_KEY)) ?? '';
}

export async function saveUserName(name: string) {
  await AsyncStorage.setItem(NAME_KEY, name.trim());
}

export async function loadJoined(): Promise<JoinedProject[]> {
  try {
    const raw = await AsyncStorage.getItem(PROJECTS_KEY);
    return raw ? (JSON.parse(raw) as JoinedProject[]) : [];
  } catch {
    return [];
  }
}

export async function saveJoined(list: JoinedProject[]) {
  await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
}
