// Point d'entrée de l'application.
//
// La tâche d'arrière-plan doit être déclarée AVANT l'enregistrement du
// composant racine : quand le système réveille l'application sans interface,
// il n'exécute aucun rendu, et une tâche définie depuis un écran n'existerait
// tout simplement pas à ce moment-là.
import "./src/pipeline/background";
import "expo-router/entry";
