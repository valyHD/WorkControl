import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyA-BrafynGDV7I7IOH5UEb53DErNzWXp5s",
  authDomain: "workcontrol-53b1d.firebaseapp.com",
  projectId: "workcontrol-53b1d",
  storageBucket: "workcontrol-53b1d.firebasestorage.app",
  messagingSenderId: "366357316965",
  appId: "1:366357316965:web:f4bbd6a0395a2b5317cd8c",
  measurementId: "G-JFB58C8PTV",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const storage = getStorage(app);

export default app;