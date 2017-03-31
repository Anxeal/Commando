global.Promise = require('bluebird');

const { CommandoClient, FriendlyError } = require('discord.js-commando');
const fs = require('fs');
const { oneLine } = require('common-tags');
const path = require('path');
const { URL } = require('url');
const winston = require('winston');

const Database = require('./structures/PostgreSQL');
const Redis = require('./structures/Redis');
const SequelizeProvider = require('./providers/Sequelize');
const { owner, token } = require('./settings');

const data = require('./docsdata.json');
const Docs = require('./src/Docs.js');
const Lookup = require('./src/Lookup.js');
const Commands = require('./src/Commands.js');

const docs = new Docs(data);
const lookup = new Lookup(data, docs);
const commands = new Commands(data, docs);

const database = new Database();
const redis = new Redis();
const client = new CommandoClient({
	owner,
	commandPrefix: '?',
	unknownCommandResponse: false,
	disableEveryone: true
});

const Currency = require('./structures/currency/Currency');
const Experience = require('./structures/currency/Experience');
const starBoard = require('./models/StarBoard');
const userName = require('./models/UserName');

let earnedRecently = [];
let gainedXPRecently = [];

database.start();
redis.start();

client.setProvider(new SequelizeProvider(Database.db));

client.dispatcher.addInhibitor(msg => {
	const blacklist = client.provider.get('global', 'userBlacklist', []);
	if (!blacklist.includes(msg.author.id)) return false;
	return `User ${msg.author.username}#${msg.author.discriminator} (${msg.author.id}) has been blacklisted.`;
});

client.on('error', winston.error)
	.on('warn', winston.warn)
	.once('ready', () => Currency.leaderboard())
	.on('ready', () => {
		winston.info(oneLine`
			Client ready... Logged in as ${client.user.username}#${client.user.discriminator} (${client.user.id})
		`);
	})
	.on('disconnect', () => winston.warn('Disconnected!'))
	.on('reconnect', () => winston.warn('Reconnecting...'))
	.on('commandRun', (cmd, promise, msg, args) => {
		winston.info(oneLine`${msg.author.username}#${msg.author.discriminator} (${msg.author.id})
			> ${msg.guild ? `${msg.guild.name} (${msg.guild.id})` : 'DM'}
			>> ${cmd.groupID}:${cmd.memberName}
			${Object.values(args)[0] !== '' || [] ? `>>> ${Object.values(args)}` : ''}
		`);
	})
	.on('message', async message => {
		if (message.channel.type === 'dm') return;
		if (message.author.bot) return;

		const channelLocks = client.provider.get(message.guild.id, 'locks', []);
		if (channelLocks.includes(message.channel.id)) return;
		if (!earnedRecently.includes(message.author.id)) {
			const hasImageAttachment = message.attachments.some(attachment =>
				attachment.url.match(/\.(png|jpg|jpeg|gif|webp)$/)
			);
			const moneyEarned = hasImageAttachment
				? Math.ceil(Math.random() * 7) + 5
				: Math.ceil(Math.random() * 7) + 1;

			Currency._changeBalance(message.author.id, moneyEarned);

			earnedRecently.push(message.author.id);
			setTimeout(() => {
				const index = earnedRecently.indexOf(message.author.id);
				earnedRecently.splice(index, 1);
			}, 8000);
		}

		if (!gainedXPRecently.includes(message.author.id)) {
			const xpEarned = Math.ceil(Math.random() * 9) + 3;
			const oldLevel = await Experience.getLevel(message.author.id);

			Experience.addExperience(message.author.id, xpEarned).then(async () => {
				const newLevel = await Experience.getLevel(message.author.id);
				if (newLevel > oldLevel) {
					Currency._changeBalance(message.author.id, 100 * newLevel);
				}
			}).catch(err => null); // eslint-disable-line no-unused-vars, handle-callback-err

			gainedXPRecently.push(message.author.id);
			setTimeout(() => {
				const index = gainedXPRecently.indexOf(message.author.id);
				gainedXPRecently.splice(index, 1);
			}, 60 * 1000);
		}
	})
	.on('message', msg => {
		if (msg.author.bot) return;
		const prefix = 'docs, ';
		if (!msg.content.toLowerCase().startsWith(prefix)) return;

		const params = msg.content.split(' ').splice(1);
		const command = params[0].toLowerCase();
		const args = params.splice(1);

		if (msg.author.id === '81440962496172032') {
			if (command === 'init') {
				if (data.channels.hasOwnProperty(msg.channel.id)) {
					msg.channel.sendMessage('Already initialized.');
					return;
				}

				if (!args[0] || !args[1]) {
					msg.channel.sendMessage('Invalid arguments.');
					return;
				}

				const gitsource = args[0].split('#');
				const gitrepo = gitsource[0].split('/');
				const owner = gitrepo[0];
				const repo = gitrepo[1];
				const branch = gitsource[1] || 'master';
				const repopath = args[1];

				if (!owner || !repo || !branch || !repopath) {
					msg.channel.sendMessage('You are missing either `owner`, `repo`, `branch` or `repopath`.');
					return;
				}

				commands.init(msg, owner, repo, branch, repopath);
				save();
				return;
			} else if (command === 'remove') {
				if (!data.channels.hasOwnProperty(msg.channel.id)) {
					msg.channel.sendMessage('Not yet initialized.');
					return;
				}

				commands.remove(msg, msg.channel.id);
				save();
				return;
			} else if (command === 'delete') {
				if (!data.channels.hasOwnProperty(msg.channel.id)) {
					msg.channel.sendMessage('Not yet initialized.');
					return;
				}

				commands.delete(msg, msg.channel.id);
				save();
				return;
			} else if (command === 'docslink') {
				const url = args[0];

				if (!data.channels.hasOwnProperty(msg.channel.id)) {
					msg.channel.sendMessage('Not yet initialized.');
					return;
				}

				commands.docslink(msg, msg.channel.id, url);
				save();
				return;
			} else if (command === 'updatedocs') {
				if (!args[0]) {
					msg.channel.sendMessage('Invalid arguments.');
					return;
				}

				const gitsource = args[0].split('#');
				const gitrepo = gitsource[0].split('/');
				const owner = gitrepo[0];
				const repo = gitrepo[1];
				const branch = gitsource[1] || 'master';

				if (!owner || !repo) {
					msg.channel.sendMessage('You are missing either `owner`, `repo`.');
					return;
				}

				commands.updateDocs(msg, owner, repo, branch);
				return;
			} else if (command === 'update') {
				commands.update(msg);
				return;
			}
		}
		if (command === 'beautify') {
			commands.beautify(msg);
			return;
		}
		lookup.respond(msg, params);
	})
	.on('messageReactionAdd', async (messageReaction, user) => {
		if (messageReaction.emoji.name !== '⭐') return;

		if (messageReaction.message.guild.member(user).joinedAt < 86400000) return; // eslint-disable-line consistent-return
		const message = messageReaction.message;
		const starboard = message.guild.channels.find('name', 'starboard');
		if (!starboard) return;
		if (message.author.id === user.id) {
			messageReaction.remove(user.id);
			return message.channel.send(`${user}, you cannot star your own messages!`); // eslint-disable-line consistent-return, max-len
		}

		let settings = await starBoard.findOne({ where: { guildID: message.guild.id } });
		if (!settings) settings = await starBoard.create({ guildID: message.guild.id });
		const starred = settings.starred;

		if (starred.hasOwnProperty(message.id)) {
			if (starred[message.id].stars.includes(user.id)) return message.channel.send(`${user}, you cannot star the same message twice!`); // eslint-disable-line consistent-return, max-len
			const starCount = starred[message.id].count += 1;
			const starredMessage = await starboard.fetchMessage(starred[message.id].starredMessageID).catch(err => null); // eslint-disable-line no-unused-vars, handle-callback-err, max-len
			const starredMessageContent = starred[message.id].starredMessageContent;
			const starredMessageAttachmentImage = starred[message.id].starredMessageImage;
			const starredMessageDate = starred[message.id].starredMessageDate;

			let edit;
			if (starCount < 5) edit = starredMessage.embeds[0].footer.text = `${starCount} ⭐`;
			else if (starCount >= 5 && starCount < 10) edit = starredMessage.embeds[0].footer.text = `${starCount} 🌟`;
			else if (starCount >= 10) edit = starredMessage.embeds[0].footer.text = `${starCount} ✨`;
			else if (starCount >= 15) edit = starredMessage.embeds[0].footer.text = `${starCount} 🌠`;

			await starredMessage.edit({
				embed: {
					author: {
						icon_url: message.author.displayAvatarURL, // eslint-disable-line camelcase
						name: `${message.author.username}#${message.author.discriminator} (${message.author.id})`
					},
					color: 0xFFAC33,
					fields: [
						{
							name: 'ID',
							value: message.id,
							inline: true
						},
						{
							name: 'Channel',
							value: message.channel.toString(),
							inline: true
						},
						{
							name: 'Message',
							value: starredMessageContent ? starredMessageContent : '\u200B'
						}
					],
					image: { url: starredMessageAttachmentImage || undefined },
					timestamp: starredMessageDate,
					footer: { text: edit }
				}
			}).catch(err => null); // eslint-disable-line no-unused-vars, handle-callback-err

			starred[message.id].count = starCount;
			starred[message.id].stars.push(user.id);
			settings.starred = starred;

			await settings.save();
		} else {
			const starCount = 1;
			let attachmentImage;
			const extensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
			const linkRegex = /https?:\/\/(?:\w+\.)?[\w-]+\.[\w]{2,3}(?:\/[\w-_\.]+)+\.(?:png|jpg|jpeg|gif|webp)/; // eslint-disable-line no-useless-escape, max-len

			if (message.attachments.some(attachment => {
				try {
					const url = new URL(attachment.url);
					const ext = path.extname(url.pathname);
					return extensions.has(ext);
				} catch (err) {
					if (err.message !== 'Invalid URL') winston.error(err);
					return false;
				}
			})) attachmentImage = message.attachments.first().url;

			if (!attachmentImage) {
				const linkMatch = message.content.match(linkRegex);
				if (linkMatch) {
					try {
						const url = new URL(linkMatch[0]);
						const ext = path.extname(url.pathname);
						if (extensions.has(ext)) attachmentImage = linkMatch[0]; // eslint-disable-line max-depth
					} catch (err) {
						if (err.message === 'Invalid URL') winston.info('No valid image link.'); // eslint-disable-line max-depth
						else winston.error(err);
					}
				}
			}

			const sentStar = await starboard.send({
				embed: {
					author: {
						icon_url: message.author.displayAvatarURL, // eslint-disable-line camelcase
						name: `${message.author.username}#${message.author.discriminator} (${message.author.id})`
					},
					color: 0xFFAC33,
					fields: [
						{
							name: 'ID',
							value: message.id,
							inline: true
						},
						{
							name: 'Channel',
							value: message.channel.toString(),
							inline: true
						},
						{
							name: 'Message',
							value: message.content ? message.cleanContent.substring(0, 1000) : '\u200B'
						}
					],
					image: { url: attachmentImage ? attachmentImage.toString() : undefined },
					timestamp: message.createdAt,
					footer: { text: `${starCount} ⭐` }
				}
			}).catch(err => null); // eslint-disable-line

			starred[message.id] = {};
			starred[message.id].authorID = message.author.id;
			starred[message.id].starredMessageID = sentStar.id;
			starred[message.id].starredMessageContent = message.cleanContent;
			starred[message.id].starredMessageImage = attachmentImage || '';
			starred[message.id].starredMessageDate = message.createdAt;
			starred[message.id].count = starCount;
			starred[message.id].stars = [];
			starred[message.id].stars.push(user.id);
			settings.starred = starred;

			await settings.save();
		}
	})
	.on('messageReactionRemove', async (messageReaction, user) => {
		if (messageReaction.emoji.name !== '⭐') return;

		const message = messageReaction.message;
		const starboard = message.guild.channels.find('name', 'starboard');
		if (!starboard) return;

		const settings = await starBoard.findOne({ where: { guildID: message.guild.id } });
		if (!settings) return;
		let starred = settings.starred;

		if (!starred.hasOwnProperty(message.id)) return;
		if (!starred[message.id].stars.includes(user.id)) return;

		const starCount = starred[message.id].count -= 1;
		const starredMessage = await starboard.fetchMessage(starred[message.id].starredMessageID).catch(err => null); // eslint-disable-line no-unused-vars, handle-callback-err, max-len

		if (starred[message.id].count === 0) {
			delete starred[message.id];
			await starredMessage.delete().catch(err => null); // eslint-disable-line no-unused-vars, handle-callback-err
		} else {
			const starredMessageContent = starred[message.id].starredMessageContent;
			const starredMessageAttachmentImage = starred[message.id].starredMessageImage;
			const starredMessageDate = starred[message.id].starredMessageDate;

			let edit;
			if (starCount < 5) edit = starredMessage.embeds[0].footer.text = `${starCount} ⭐`;
			else if (starCount >= 5 && starCount < 10) edit = starredMessage.embeds[0].footer.text = `${starCount} 🌟`;
			else if (starCount >= 10) edit = starredMessage.embeds[0].footer.text = `${starCount} ✨`;
			else if (starCount >= 15) edit = starredMessage.embeds[0].footer.text = `${starCount} 🌠`;

			await starredMessage.edit({
				embed: {
					author: {
						icon_url: message.author.displayAvatarURL, // eslint-disable-line camelcase
						name: `${message.author.username}#${message.author.discriminator} (${message.author.id})`
					},
					color: 0xFFAC33,
					fields: [
						{
							name: 'ID',
							value: message.id,
							inline: true
						},
						{
							name: 'Channel',
							value: message.channel.toString(),
							inline: true
						},
						{
							name: 'Message',
							value: starredMessageContent ? starredMessageContent : '\u200B'
						}
					],
					image: { url: starredMessageAttachmentImage ? starredMessageAttachmentImage : undefined },
					timestamp: starredMessageDate,
					footer: { text: edit }
				}
			}).catch(err => null); // eslint-disable-line no-unused-vars, handle-callback-err

			starred[message.id].count = starCount;
			starred[message.id].stars.splice(starred[message.id].stars.indexOf(user.id));
		}

		settings.starred = starred;
		await settings.save();
	})
	.on('unknownCommand', msg => {
		if (msg.channel.type === 'dm') return;
		if (msg.author.bot) return;

		const args = { name: msg.content.split(client.commandPrefix)[1] };
		client.registry.resolveCommand('tags:tag').run(msg, args);
	})
	.on('commandError', (cmd, err) => {
		if (err instanceof FriendlyError) return;
		winston.error(`Error in command ${cmd.groupID}:${cmd.memberName}`, err);
	})
	.on('commandBlocked', (msg, reason) => {
		winston.info(oneLine`
			Command ${msg.command ? `${msg.command.groupID}:${msg.command.memberName}` : ''}
			blocked; User ${msg.author.username}#${msg.author.discriminator} (${msg.author.id}): ${reason}
		`);
	})
	.on('commandPrefixChange', (guild, prefix) => {
		winston.info(oneLine`
			Prefix changed to ${prefix || 'the default'}
			${guild ? `in guild ${guild.name} (${guild.id})` : 'globally'}.
		`);
	})
	.on('commandStatusChange', (guild, command, enabled) => {
		winston.info(oneLine`
			Command ${command.groupID}:${command.memberName}
			${enabled ? 'enabled' : 'disabled'}
			${guild ? `in guild ${guild.name} (${guild.id})` : 'globally'}.
		`);
	})
	.on('groupStatusChange', (guild, group, enabled) => {
		winston.info(oneLine`
			Group ${group.id}
			${enabled ? 'enabled' : 'disabled'}
			${guild ? `in guild ${guild.name} (${guild.id})` : 'globally'}.
		`);
	})
	.on('userUpdate', (oldUser, newUser) => {
		if (oldUser.username !== newUser.username) {
			userName.create({ userID: newUser.id, username: oldUser.username }).catch(err => null); // eslint-disable-line no-unused-vars, handle-callback-err, max-len
		}
	});

client.registry
	.registerGroups([
		['info', 'Info'],
		['economy', 'Economy'],
		['social', 'Social'],
		['games', 'Games'],
		['item', 'Item'],
		['weather', 'Weather'],
		['music', 'Music'],
		['tags', 'Tags'],
		['starboard', 'Starboard'],
		['rep', 'Reputation']
	])
	.registerDefaults()
	.registerTypesIn(path.join(__dirname, 'types'))
	.registerCommandsIn(path.join(__dirname, 'commands'));

function save() {
	fs.writeFileSync('./docsdata.json', JSON.stringify(data));
}

setInterval(save, 60 * 1000);

client.login(token);

process.on('unhandledRejection', err => {
	console.error(`Uncaught Promise Error: \n${err.stack}`); // eslint-disable-line no-console
});
