const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  SlashCommandBuilder, 
  REST, 
  Routes 
} = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');

// Carga las credenciales desde las Variables de Entorno del hosting
const TOKEN = process.env.TOKEN || 'TU_BOT_TOKEN_AQUI';
const CLIENT_ID = process.env.CLIENT_ID || 'TU_CLIENT_ID_AQUI';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Inicializar reproductor de audio
const player = new Player(client);

// 1. Definición de Slash Commands (/)
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Reproduce una canción o playlist')
    .addStringOption(option =>
      option.setName('busqueda')
        .setDescription('Nombre o enlace de la canción/playlist')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Conecta el bot a tu canal de voz actual'),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Desconecta el bot del canal de voz'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Salta a la siguiente canción'),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Ajusta el volumen del bot (0 a 100)')
    .addIntegerOption(option =>
      option.setName('nivel')
        .setDescription('Nivel de volumen (0-100)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa la música'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Reanuda la música'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Detiene la música y limpia la cola'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Muestra la lista de canciones en cola'),
].map(command => command.toJSON());

// 2. Registrar los Slash Commands globalmente al iniciar
client.once('ready', async () => {
  await player.extractors.loadMulti(DefaultExtractors);
  console.log(`🤖 MODEOS EL OBI MUSICA iniciado como: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('🔄 Registrando comandos Slash (/)....');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('✅ ¡Comandos Slash registrados exitosamente!');
  } catch (error) {
    console.error('❌ Error al registrar comandos:', error);
  }
});

// 3. Evento cuando empieza a sonar una canción
player.events.on('playerStart', (queue, track) => {
  const embed = new EmbedBuilder()
    .setColor('#1DB954')
    .setTitle('🎶 Sonando ahora')
    .setDescription(`[${track.title}](${track.url})`)
    .addFields(
      { name: 'Duración', value: track.duration, inline: true },
      { name: 'Solicitado por', value: `${track.requestedBy}`, inline: true },
      { name: 'Volumen', value: `${queue.node.volume}%`, inline: true }
    )
    .setThumbnail(track.thumbnail);

  queue.metadata.channel.send({ embeds: [embed] });
});

// 4. Manejador de Interacciones (/comandos)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild, channel } = interaction;
  const voiceChannel = member.voice.channel;

  // Validar si el usuario está en un canal de voz
  if (!voiceChannel) {
    return interaction.reply({
      content: '❌ Debes estar en un canal de voz para usar este comando.',
      ephemeral: true,
    });
  }

  // --- /JOIN ---
  if (commandName === 'join') {
    const queue = player.nodes.create(guild, {
      metadata: { channel: channel },
      selfDeaf: true,
      volume: 80,
    });

    try {
      if (!queue.connection) await queue.connect(voiceChannel);
      return interaction.reply(`🔊 Conectado al canal de voz **${voiceChannel.name}**.`);
    } catch {
      queue.delete();
      return interaction.reply({ content: '❌ No se pudo conectar al canal de voz.', ephemeral: true });
    }
  }

  // --- /LEAVE ---
  if (commandName === 'leave') {
    const queue = player.nodes.get(guild.id);

    if (queue) {
      queue.delete();
      return interaction.reply('👋 Desconectado del canal de voz.');
    } else if (guild.members.me.voice.channel) {
      guild.members.me.voice.disconnect();
      return interaction.reply('👋 Desconectado del canal de voz.');
    } else {
      return interaction.reply({ content: '❌ El bot no está en ningún canal de voz.', ephemeral: true });
    }
  }

  // --- /PLAY ---
  if (commandName === 'play') {
    await interaction.deferReply();
    const query = interaction.options.getString('busqueda');

    const queue = player.nodes.create(guild, {
      metadata: { channel: channel },
      selfDeaf: true,
      volume: 80,
    });

    try {
      if (!queue.connection) await queue.connect(voiceChannel);
    } catch {
      queue.delete();
      return interaction.followUp('❌ No pude conectarme a tu canal de voz.');
    }

    const result = await player.search(query, {
      requestedBy: interaction.user,
    });

    if (!result.hasTracks()) {
      return interaction.followUp('❌ No se encontraron resultados.');
    }

    if (result.playlist) {
      queue.addTrack(result.tracks);
      await interaction.followUp(`✅ Playlist añadida: **${result.playlist.title}** (${result.tracks.length} canciones)`);
    } else {
      queue.addTrack(result.tracks[0]);
      await interaction.followUp(`➕ Añadida a la cola: **${result.tracks[0].title}**`);
    }

    if (!queue.isPlaying()) await queue.node.play();
  }

  // --- /SKIP ---
  if (commandName === 'skip') {
    const queue = player.nodes.get(guild.id);
    if (!queue || !queue.isPlaying()) {
      return interaction.reply({ content: '❌ No hay ninguna canción sonando para saltar.', ephemeral: true });
    }

    const currentTrack = queue.currentTrack;
    queue.node.skip();

    return interaction.reply(`⏭️ Se ha saltado la canción: **${currentTrack.title}**`);
  }

  // --- /VOLUME ---
  if (commandName === 'volume') {
    const queue = player.nodes.get(guild.id);
    if (!queue || !queue.isPlaying()) {
      return interaction.reply({ content: '❌ No hay reproducción activa para cambiar el volumen.', ephemeral: true });
    }

    const newVolume = interaction.options.getInteger('nivel');
    queue.node.setVolume(newVolume);

    return interaction.reply(`🔊 Volumen ajustado a: **${newVolume}%**`);
  }

  // --- /PAUSE ---
  if (commandName === 'pause') {
    const queue = player.nodes.get(guild.id);
    if (!queue || !queue.isPlaying()) {
      return interaction.reply({ content: '❌ No hay nada sonando.', ephemeral: true });
    }

    queue.node.pause();
    return interaction.reply('⏸️ Música pausada.');
  }

  // --- /RESUME ---
  if (commandName === 'resume') {
    const queue = player.nodes.get(guild.id);
    if (!queue) {
      return interaction.reply({ content: '❌ No hay música para reanudar.', ephemeral: true });
    }

    queue.node.resume();
    return interaction.reply('▶️ Música reanudada.');
  }

  // --- /STOP ---
  if (commandName === 'stop') {
    const queue = player.nodes.get(guild.id);
    if (!queue) {
      return interaction.reply({ content: '❌ El bot no está en un canal reproduciendo música.', ephemeral: true });
    }

    queue.delete();
    return interaction.reply('🛑 Reproducción detenida y lista borrada.');
  }

  // --- /QUEUE ---
  if (commandName === 'queue') {
    const queue = player.nodes.get(guild.id);
    if (!queue || !queue.isPlaying()) {
      return interaction.reply({ content: '❌ La lista de reproducción está vacía.', ephemeral: true });
    }

    const currentTrack = queue.currentTrack;
    const tracks = queue.tracks.toArray().slice(0, 5);

    let queueString = `**Sonando ahora:**\n🎶 [${currentTrack.title}](${currentTrack.url})\n\n**Siguientes:**\n`;

    if (tracks.length === 0) {
      queueString += 'No hay más canciones en la cola.';
    } else {
      queueString += tracks.map((track, i) => `**${i + 1}.** [${track.title}](${track.url})`).join('\n');
    }

    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('📋 Cola de Reproducción')
      .setDescription(queueString);

    return interaction.reply({ embeds: [embed] });
  }
});

client.login(TOKEN);MTU0ODg0MjA3NjU1OTUxMTU1Mg.Guy6ob.jGxxu5OnJ9n3JL5nPj7XUvpU6PJbHi6cPhP5qY