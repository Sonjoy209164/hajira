declare module "@react-native-async-storage/async-storage" {
  const AsyncStorage: any;
  export default AsyncStorage;
}

declare module "@react-native-community/netinfo" {
  const NetInfo: any;
  export default NetInfo;
}

declare module "expo-constants" {
  const Constants: any;
  export default Constants;
}

declare module "expo-location" {
  export type LocationObject = any;
  export type LocationSubscription = any;
  export const Accuracy: any;
  export function hasServicesEnabledAsync(...args: any[]): Promise<boolean>;
  export function requestForegroundPermissionsAsync(...args: any[]): Promise<any>;
  export function requestBackgroundPermissionsAsync(...args: any[]): Promise<any>;
  export function startLocationUpdatesAsync(...args: any[]): Promise<any>;
  export function stopLocationUpdatesAsync(...args: any[]): Promise<any>;
  export function hasStartedLocationUpdatesAsync(...args: any[]): Promise<boolean>;
  export function watchPositionAsync(...args: any[]): Promise<LocationSubscription>;
}

declare module "expo-task-manager" {
  export function defineTask(...args: any[]): void;
}

declare module "react-native" {
  export const Linking: any;
  export const PermissionsAndroid: any;
  export const Platform: any;
}

