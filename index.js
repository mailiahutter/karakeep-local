// Point d'entrée de l'application.
//
// Les deux imports qui précèdent `expo-router/entry` déclarent le travail
// d'arrière-plan. L'ordre compte : quand Android démarre le moteur
// JavaScript sans interface, il n'exécute aucun rendu, et une tâche déclarée
// depuis un écran n'existerait pas à ce moment-là.
import "./src/pipeline/background";
import "./src/pipeline/headlessTask";
import "expo-router/entry";
