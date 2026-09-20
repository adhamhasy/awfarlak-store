// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  set,
  onValue,
  remove,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {

  apiKey: "AIzaSyA-wV9myRJyD6eTp-Ak3mLWU8qnWKr30qw",

  authDomain: "letsgo-c4a7c.firebaseapp.com",

  databaseURL: "https://letsgo-c4a7c-default-rtdb.firebaseio.com",

  projectId: "letsgo-c4a7c",

  storageBucket: "letsgo-c4a7c.firebasestorage.app",

  messagingSenderId: "327919496932",

  appId: "1:327919496932:web:fa47bd11a0d13e7c97c6f1",

  measurementId: "G-HB81DELVQ0"

};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

export { db, ref, push, set, onValue, remove, storage, storageRef, uploadBytes, getDownloadURL };
