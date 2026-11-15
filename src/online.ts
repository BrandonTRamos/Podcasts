import { useSyncExternalStore } from 'react'
import type { Device } from './services'

/** Whether the device is online, re-rendering the calling component when that changes. */
export function useOnline(device: Pick<Device, 'isOnline' | 'watchConnectivity'>): boolean {
  return useSyncExternalStore(device.watchConnectivity, device.isOnline)
}
