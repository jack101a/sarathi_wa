const ALIVE_MEMES = [
  {
    url: 'https://media.tenor.com/VCpBWDa2c7gAAAPo/welcome-abhi-hum-zinda-hai.mp4',
    caption: 'Abhi hum zinda hai.',
  },
  {
    url: 'https://media.tenor.com/BhQ2V3y4XxAAAAPo/behra-behra-nahi.mp4',
    caption: 'Sunai de raha hai. Behra nahi hu mai.',
  },
];

function getRandomAliveMeme() {
  const index = Math.floor(Math.random() * ALIVE_MEMES.length);
  return ALIVE_MEMES[index];
}

module.exports = {
  ALIVE_MEMES,
  getRandomAliveMeme,
};
