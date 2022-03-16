const audio = document.getElementById("audio");
const playPause = document.getElementById("play");

playPause.addEventListener("click", () => {

    if (audio.paused || audio.ended) {
        playPause.querySelector(".pause-btn").classList.toggle()
    }

});