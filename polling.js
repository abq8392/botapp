/* Polling to see whether there is a case almost due */
var Botkit = require('botkit');
var moment = require('moment');

module.exports = {

    polling : function (bot) {
        var current_time = parseInt(moment().format('X')) + 28800;
        console.log("current time = " + current_time);
        controller.storage.teams.get('T1PG5SWSC', function(err, team) {

            if (team.hasOwnProperty('polling_case')) {
                var polling_case = team.polling_case;
                for (var i = 0; i < polling_case.length; i++) {
                    if ((polling_case[i].details.due_date - current_time) >= 3600 && (polling_case[i].details.due_date - current_time) < 3660) {

                        var broadcast_im = function broadcast(users_list) {
                            for (var i = 0; i < users_list.length; i++) {
                                bot.startPrivateConversation({ user: users_list[i] }, function(err, convo) {
                                    if (err) {
                                        console.log(err);
                                    } else {
                                        convo.say(':bell:編號#' + polling_case[i].case_id + '將在一個小時後截止!');
                                    }
                                });
                            }
                        }

                        get_list(bot, function(users_list) {
                            broadcast_im(users_list);
                        });

                    }
                }
            }
        });
    }

}