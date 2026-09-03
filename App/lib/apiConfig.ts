import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
const STORAGE_KEY = 'music-room:api-base-url';

let currentBaseUrl: string = DEFAULT_API_BASE_URL;

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    throw new Error("L'adresse doit commencer par http:// ou https://");
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
      currentBaseUrl = normalizeBaseUrl(stored);
    }
  } catch (error) {
    console.log('Error reading stored API URL:', error);
  }
  return currentBaseUrl;
}

export async function setApiBaseUrl(url: string): Promise<string> {
  const normalized = normalizeBaseUrl(url);
  currentBaseUrl = normalized;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, normalized);
  } catch (error) {
    console.log('Error persisting API URL:', error);
    throw error;
  }
  return normalized;
}

export async function resetApiBaseUrl(): Promise<void> {
  currentBaseUrl = DEFAULT_API_BASE_URL;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.log('Error clearing stored API URL:', error);
    throw error;
  }
}