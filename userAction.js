var Botkit = require('botkit');
var pollCase = require('./pollCase.js');
var userCase = require('./userCase.js');

module.exports = {

    // User decide to join a new case
    joinCase: function(controller, bot, message, case_id, user_id) {

        controller.storage.teams.get(message.team.id, function(err, team) {
            //To see join the clicking user or not && whether the people number acheive
            var polling_case = team.polling_case;
            if (message.actions[0].value == 'join') {

                for (var i in polling_case) {
                    if (case_id == polling_case[i].case_id) {

                        pollCase.updateCase(controller, bot, user_id, case_id);
                        userCase.addCase(controller, user_id, case_id);
                        bot.replyInteractive(message, ':white_check_mark: 你已報名參與此投票');
                    }
                }
            } else if (message.actions[0].value == 'no') {
                bot.replyInteractive(message, '你將不會參與此次投票:relieved:');
            }
            controller.storage.teams.save(team);
        });
    },

    goVoteCase: function(controller, bot, message, case_id, user_id, choice) {
        controller.storage.teams.get(message.team.id, function(err, team) {
            var option_order = message.actions[0].value;
            var polling_case = team.polling_case;
            var case_type;
            var unique_ticket = 0;

            for (var i in polling_case) {
                if (case_id == polling_case[i].case_id) {

                    if (polling_case[i].details.type == 'poll') {
                        polling_case[i].details.option[option_order].count++;
                    }

                    // Generate unique random number from 1000 to 9999
                    do {
                        unique_ticket = Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
                    } while (polling_case[i].tickets.indexOf(unique_ticket) != -1); // The ticket has existed.

                    polling_case[i].tickets.push(unique_ticket); // 已發出去的票卷號碼
                    polling_case[i].details.option[option_order].tickets.push(unique_ticket); // 紀錄票卷放入哪個選項當中

                    userCase.updateCase(controller, user_id, case_id, choice, unique_ticket);
                    bot.replyInteractive(message, ':white_check_mark: Thank you! You have chosen ' + choice +
                        '\n票卷號碼為：' + unique_ticket);
                    break;
                }
            }
            controller.storage.teams.save(team);
        });
    }
}