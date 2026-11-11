/* הגדרות Firebase.
   כל עוד הערך null האתר פועל ב"מצב הדגמה": הנתונים נשמרים רק במכשיר הזה.
   כדי להפעיל סנכרון חי בין הבוחנים, הדבק כאן את אובייקט ה-firebaseConfig
   מתוך Firebase Console ‹ Project settings ‹ Your apps (חייב לכלול databaseURL):

   window.FIREBASE_CONFIG = {
     apiKey: "...",
     authDomain: "...",
     databaseURL: "https://....firebasedatabase.app",
     projectId: "...",
     appId: "..."
   };
*/
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDj9X-fRn9410PTPLtd8Pk4ueNUqYj0eTA",
  authDomain: "realtime-judge-clipboard.firebaseapp.com",
  databaseURL: "https://realtime-judge-clipboard-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "realtime-judge-clipboard",
  storageBucket: "realtime-judge-clipboard.firebasestorage.app",
  messagingSenderId: "751162623429",
  appId: "1:751162623429:web:79ce54cc8ceda1adcb77ac"
};
