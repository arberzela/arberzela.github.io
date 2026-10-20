// Scenes and data of the PBT-NCA hero (shared by the component markup and the client script): the
// highest-scoring world of one PBT-NCA run (30 worlds of 7 agents, 500 meta-iterations) at eight of the
// meta-iterations shown in the paper's Figure 2, and that run's mean composite score.

export interface WorldScene {
  iter: number; // meta-iteration
  name: string;
  desc: string;
  slug: string; // media/<slug>.mp4 and media/<slug>.png (the poster frame)
}

export const MEDIA = '/blog/pbt-nca/media';

export const WORLD_SCENES: WorldScene[] = [
  {
    iter: 20,
    name: 'Noise',
    desc: 'Early in the run the best of the 30 worlds is high-entropy noise: seven agents mixed cell by cell, with nothing that lasts. The mean score is at its lowest.',
    slug: 'run7-iter020',
  },
  {
    iter: 145,
    name: 'Spiral waves',
    desc: 'Nested square spirals hold their shape while bands of color travel through them, like the rotating spiral waves of cyclic competition in multi-agent ecosystems.',
    slug: 'run7-iter145',
  },
  {
    iter: 230,
    name: 'Amoeba',
    desc: 'Fluid, shape-shifting macro-structures migrate across the dish with coordinated, differentiated cell behavior, reminiscent of motility-induced phase separation.',
    slug: 'run7-iter230',
  },
  {
    iter: 310,
    name: 'Pirate world',
    desc: 'An archipelago and shooters in one world: islands of territory in open water, with small clusters of cells scattered between them.',
    slug: 'run7-iter310',
  },
  {
    iter: 355,
    name: 'Mazes and turbulence',
    desc: 'Order beside turbulence: rigid spiral mazes fill part of the dish while a churning mix of agents fills the rest.',
    slug: 'run7-iter355',
  },
  {
    iter: 395,
    name: 'Alien',
    desc: 'The environment (black) reclaims almost the whole dish. One agent survives as a thin violet outline near the edge: the alien-like glyph.',
    slug: 'run7-iter395',
  },
  {
    iter: 415,
    name: 'Circuits',
    desc: 'Rigid, circuit-like spiral domains of all seven agents, packed edge to edge, with color waves running along their walls.',
    slug: 'run7-iter415',
  },
  {
    iter: 460,
    name: 'Glider',
    desc: 'A red chevron edged in green glides diagonally across a dish the environment has mostly reclaimed, past magenta bodies that hold still.',
    slug: 'run7-iter460',
  },
];

/** Agent colors of the 7-agent renderings (hue k/7 at saturation 0.8, value 0.9); black is the environment. */
export const AGENT_COLORS = ['#e62e2e', '#e6cb2e', '#62e62e', '#2ee697', '#2e97e6', '#622ee6', '#e62ecb'];

export const META_ITERATIONS = 500;

/** Mean composite score of the population at meta-iterations 1..500 (rolling mean over 10, as in Figure 2). */
export const MEAN_SCORE: number[] = [
  .434, .423, .418, .405, .395, .388, .407, .382, .363, .337, .315, .304, .291, .286, .281, .281, .280, .280, .279, .275,
  .276, .280, .284, .286, .292, .290, .295, .296, .297, .303, .309, .314, .315, .324, .322, .326, .326, .335, .342, .346,
  .350, .347, .363, .365, .374, .380, .383, .383, .399, .410, .408, .425, .418, .430, .441, .449, .451, .464, .463, .469,
  .483, .473, .488, .491, .480, .483, .485, .479, .479, .469, .471, .492, .494, .495, .512, .515, .514, .507, .495, .488,
  .475, .459, .447, .440, .427, .417, .437, .458, .477, .500, .520, .519, .517, .516, .515, .513, .512, .511, .495, .494,
  .478, .492, .510, .521, .534, .547, .527, .509, .518, .513, .514, .509, .505, .505, .506, .503, .519, .537, .540, .544,
  .554, .559, .555, .553, .553, .552, .549, .546, .544, .541, .546, .544, .548, .547, .543, .545, .544, .541, .541, .541,
  .535, .532, .525, .525, .528, .526, .526, .525, .527, .526, .529, .528, .527, .526, .521, .518, .524, .531, .531, .535,
  .535, .539, .543, .548, .554, .557, .550, .548, .547, .544, .544, .541, .541, .538, .538, .535, .538, .537, .540, .541,
  .542, .540, .539, .535, .532, .537, .539, .544, .540, .544, .550, .548, .549, .551, .551, .552, .548, .542, .545, .539,
  .536, .539, .539, .539, .540, .533, .534, .534, .530, .533, .529, .526, .521, .519, .515, .517, .515, .512, .508, .504,
  .501, .500, .502, .504, .503, .499, .498, .497, .500, .498, .500, .503, .502, .499, .505, .510, .515, .515, .515, .519,
  .524, .524, .529, .532, .535, .538, .533, .537, .537, .534, .536, .535, .530, .529, .526, .522, .525, .524, .528, .533,
  .527, .525, .526, .526, .522, .524, .523, .522, .520, .516, .517, .517, .517, .519, .518, .516, .515, .518, .514, .515,
  .517, .519, .517, .512, .514, .514, .515, .509, .511, .507, .498, .497, .497, .500, .499, .497, .496, .499, .497, .500,
  .501, .497, .498, .495, .493, .489, .488, .485, .484, .481, .481, .481, .476, .476, .479, .479, .479, .481, .480, .480,
  .477, .480, .492, .494, .496, .502, .507, .511, .520, .528, .538, .542, .540, .543, .544, .549, .552, .555, .555, .558,
  .558, .560, .561, .566, .568, .569, .568, .571, .572, .570, .569, .573, .580, .579, .584, .588, .588, .591, .593, .593,
  .591, .590, .583, .580, .573, .569, .573, .569, .566, .571, .577, .571, .576, .573, .574, .572, .560, .558, .552, .542,
  .535, .536, .529, .528, .527, .527, .533, .532, .534, .539, .542, .542, .539, .539, .540, .538, .539, .539, .537, .535,
  .530, .531, .534, .535, .535, .537, .532, .530, .533, .531, .533, .532, .532, .532, .531, .529, .535, .541, .539, .547,
  .549, .550, .554, .560, .557, .564, .564, .562, .567, .570, .574, .575, .571, .569, .575, .578, .585, .589, .585, .581,
  .578, .579, .585, .586, .589, .586, .578, .580, .584, .585, .586, .587, .584, .586, .582, .580, .587, .585, .588, .590,
  .591, .592, .594, .591, .593, .592, .595, .599, .594, .589, .587, .590, .591, .593, .592, .595, .588, .583, .584, .588,
  .588, .589, .585, .584, .585, .584, .579, .578, .577, .573, .571, .567, .569, .567, .565, .565, .568, .567, .567, .568,
];

export const sceneTitle = (s: WorldScene) => `Meta-iteration ${s.iter} · ${s.name}`.toUpperCase();
