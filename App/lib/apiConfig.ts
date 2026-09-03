import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_BASE_URL = (() => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (envUrl.trim()) {
    try {
      return normalizeBaseUrl(envUrl);
    } catch {
      // env invalide → repli sur le défaut plateforme
    }
  }
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
})();
const STORAGE_KEY = 'music-room:api-base-url';

let currentBaseUrl: string = DEFAULT_API_BASE_URL;

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s?#]+$/i.test(trimmed)) {
    throw new Error("L'adresse doit commencer par http:// ou https://, sans chemin, paramètre ni ancre");
  }
  return trimmed;
}

export function getApiBaseUrl(): string {
  return currentBaseUrl;
}

export function getWsBaseUrl(): string {
  const match = /^(https?):\/\/([^/]+)/i.exec(currentBaseUrl);
  if (!match) return '';
  const scheme = match[1].toLowerCase();
  return `${scheme === 'https' ? 'wss' : 'ws'}://${match[2]}`;
}

export async function initApiConfig(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim()) {
      try {
        currentBaseUrl = normalizeBaseUrl(stored);
      } catch (error) {
        console.log('Stored API URL invalide, suppression:', error);
        await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      }
    }
  } catch (error) {
    console.log('Error reading stored API URL:', error);
  }
  return currentBaseUrl;
}

export async function setApiBaseUrl(url: string): Promise<string> {
  const normalized = normalizeBaseUrl(url);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, normalized);
  } catch (error) {
    console.log('Error persisting API URL:', error);
    throw error;
  }
  currentBaseUrl = normalized;
  return normalized;
}

export async function resetApiBaseUrl(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.log('Error clearing stored API URL:', error);
    throw error;
  }
  currentBaseUrl = DEFAULT_API_BASE_URL;
}