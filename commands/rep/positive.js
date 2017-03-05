const { Command } = require('discord.js-commando');

const UserRep = require('../../postgreSQL/models/UserRep');

module.exports = class RepPositiveCommand extends Command {
	constructor(client) {
		super(client, {
			name: 'rep-add',
			aliases: ['add-rep', 'rep-pos', 'pos-rep', '++'],
			group: 'rep',
			memberName: 'positive',
			description: 'Add a positive reputation point to a user.',

			args: [
				{
					key: 'user',
					prompt: 'whom would you like to give a positive reputation point?',
					type: 'user'
				},
				{
					key: 'message',
					prompt: 'add a nice message.',
					type: 'string',
					max: 200,
					default: ''
				}
			]
		});
	}

	async run(msg, args) {
		const { user, message } = args;

		if (user.id === msg.author.id) return msg.reply('you can\'t change your own reputation like that!');

		const alreadyRepped = await UserRep.findOne({
			where: {
				userID: user.id,
				reputationBy: msg.author.id
			}
		});

		if (alreadyRepped && alreadyRepped.reputationType === '+') return msg.reply('you have already given a positive reputation point to this user.');
		if (alreadyRepped) await alreadyRepped.destroy();

		await UserRep.create({
			userID: user.id,
			reputationType: '+',
			reputationBy: msg.author.id,
			reputationMessage: message || null
		});

		return msg.reply(`you've successfully added a positive reputation point to ${user.displayName}.`);
	}
};
