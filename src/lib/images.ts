import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Pick an image and return it as a small PNG data URI (for logos stored in the database). */
export async function pickSmallImage(maxWidth = 320): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled || !res.assets?.length) return null;
  const ctx = ImageManipulator.manipulate(res.assets[0].uri);
  if ((res.assets[0].width || 0) > maxWidth) ctx.resize({ width: maxWidth });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, format: SaveFormat.PNG });
  if (!out.base64) return null;
  const uri = `data:image/png;base64,${out.base64}`;
  if (uri.length > 300_000) throw new Error('This image is too large for a logo. Choose a smaller one.');
  return uri;
}
