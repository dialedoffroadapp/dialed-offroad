// lib/bikePhoto.ts
// The rider's own bike photo (Home glance tile, Garage identity card).
// Mirrors profile.tsx's avatar upload: expo-image-picker → bytes → storage.
// Bucket `bike-photos` + `bikes.photo_path` arrive with migration
// 20260904100000 (STAGED); until then the upload fails and the caller shows
// a toast. The public URL is cached per bike so the tile renders offline.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveBikeExtras } from "./bikeExtras";
import { supabase } from "./supabase";

export const BIKE_PHOTO_BUCKET = "bike-photos";
const urlKey = (bikeId: string) => `bike_photo_url_v1:${bikeId}`;

export async function readCachedBikePhotoUrl(bikeId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(urlKey(bikeId));
  } catch {
    return null;
  }
}

export function publicUrlForPath(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    const { data } = supabase.storage.from(BIKE_PHOTO_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

export type PickResult = { status: "ok"; url: string } | { status: "cancelled" } | { status: "failed"; message: string };

export async function pickAndUploadBikePhoto(userId: string, bikeId: string): Promise<PickResult> {
  let ImagePicker: any;
  try {
    ImagePicker = require("expo-image-picker");
  } catch {
    return { status: "failed", message: "Photos need an app update." };
  }
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm?.granted) return { status: "failed", message: "Photo access is off for Dialed." };
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaType?.Images ?? ImagePicker.MediaTypeOptions?.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (res?.canceled || !res?.assets?.[0]?.uri) return { status: "cancelled" };
    const asset = res.assets[0];
    const bytes = new Uint8Array(await (await fetch(asset.uri)).arrayBuffer());
    const ext = (asset.fileName?.split(".").pop() || "jpg").toLowerCase();
    const path = `${userId}/${bikeId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BIKE_PHOTO_BUCKET).upload(path, bytes, {
      upsert: true,
      cacheControl: "3600",
      contentType: asset.mimeType || "image/jpeg",
    });
    if (error) return { status: "failed", message: "Couldn't save the photo yet. Try again after the next update." };
    const url = publicUrlForPath(path);
    if (!url) return { status: "failed", message: "Couldn't read the photo back." };
    await saveBikeExtras(bikeId, { photoPath: path });
    try {
      await AsyncStorage.setItem(urlKey(bikeId), url);
    } catch {
      // ignore
    }
    return { status: "ok", url };
  } catch (e: any) {
    return { status: "failed", message: e?.message ?? "Couldn't add the photo." };
  }
}
