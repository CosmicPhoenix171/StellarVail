// Firebase Configuration — StellarVail project
// Values supplied by the project owner; used by the compat SDK loaded in index.html.
const firebaseConfig = {
    apiKey: "AIzaSyCx5L9o7rmdM2TzgjMEKjOGAXeUarAI_ew",
    authDomain: "stellarvail.firebaseapp.com",
    databaseURL: "https://stellarvail-default-rtdb.firebaseio.com",
    projectId: "stellarvail",
    storageBucket: "stellarvail.firebasestorage.app",
    messagingSenderId: "963564296876",
    appId: "1:963564296876:web:e333c37414e59e069b1d09",
    measurementId: "G-RRXCY736RH"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get a reference to the database service
const database = firebase.database();
