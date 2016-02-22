/**
 * Github API helper methods.
 *
 * @package  build
 * @author   Andrew Sliwinski <a@mozillafoundation.org>
 */

var async = require('async');
var lru = require('lru-cache');
var request = require('request');

/**
 * Constructor
 */
function Github(token, cacheAge) {
  var _this = this;
  _this.token = token;
  _this.host = 'https://api.github.com';
  _this.repo = '/repos/MozillaFoundation/plan';
  _this.cache = lru({
    max: 500,
    maxAge: cacheAge || 60 * 60 * 1000 // default: every hour
  });

  /**
   * Express middleware adapter. Attaches user information to the request if an
   * auth token exists within the session object.
   *
   * @param  {object}   req  Request
   * @param  {object}   res  Response
   * @param  {Function} next Callback
   */
  _this.middleware = function(req, res, next) {
    // If no token exists in the session, continue
    if (!req.session.token) {
      res.locals.user = null;
      return next();
    }

    // If token exists, fetch user from Github API & continue
    _this.getUserFromToken(req.session.token, function(err, user) {
      // Handle error state(s)
      if (err) {
        req.session.token = null;
        res.locals.user = null;
        return next();
      }

      // Attach user object to res.locals for template rendering
      res.locals.user = user;
      next();
    });
  };

  /**
   * Returns an object of arrays for "p1" and "p2" issues.
   *
   * @param  {array} issues  Issues from the Github api
   *
   * @return {object}
   */
  _this.sortIssuesByPriority = function(issues) {
    var result = {
      p1: [],
      p2: []
    };

    for (var i = 0; i < issues.length; i++) {
      var issue = issues[i];
      var isPriority = false;

      for (var l = 0; l < issue.labels.length; l++) {
        if (issue.labels[l].name === 'p1') {
          isPriority = true;
          break;
        }
      }

      var target = (isPriority) ? result.p1 : result.p2;
      target.push(issue);
    }
    return result;
  }
}

Github.prototype.githubRequestAllPages = function(options, callback) {
  var collection = [];

  // Fetch deals with multiple pages.
  // The data this code deals with is small enough,
  // so just return all pages worth of data.
  var fetch = function(page) {
    var query = "/" + options.query + "?page=" + page;
    this.githubJSON(query, function(error, data) {
      if (error) {
        console.log(error);
      } else {
        if (data.length) {
          collection = collection.concat(data);
          // We have new data, keep going.
          fetch(++page);
        } else if (collection.length) {
          // Looks like we're done.
          callback(error, collection);
        } else if (data.message) {
          // Likely a not found error.
          console.log("warning: " + data.message + " " + query);
          callback(error, []);
        } else {
          // Likely dealing with non array data. We can stop.
          callback(error, data);
        }
      }
    });
  }.bind(this);

  fetch(0);
};

Github.prototype.githubJSON = function(fragment, callback) {
  var _this = this;
  var url = "https://api.github.com" + fragment;
  var copy = _this.cache.get(url);
  if (typeof copy !== 'undefined') {
    return callback(null, copy);
  }

  if (!_this.token) {
    return callback(new Error("No token defined"));
  }

  // Request from API
  request({
    method: 'GET',
    uri: url,
    headers: {
      'User-Agent': 'build.webmaker.org',
      Accept: 'application/vnd.github.v3+json',
      Authorization: 'token ' + _this.token
    },
    json: {}
  }, function(err, res, body) {
    if (err) return callback(err);
    // Set cache & return
    _this.cache.set(url, body);
    callback(err, body);
  });
}

/**
 * Returns a user object from the Github API based on the provided auth token.
 *
 * @param  {string}   token    OAuth token provided by Github
 * @param  {Function} callback
 */
Github.prototype.getUserFromToken = function(token, callback) {
  var _this = this;

  request({
    method: 'GET',
    uri: _this.host + '/user',
    headers: {
      'User-Agent': 'build.webmaker.org',
      Accept: 'application/vnd.github.v3+json',
      Authorization: 'token ' + token
    },
    json: {}
  }, function(err, res, body) {
    callback(err, body);
  });
};

/**
 * Creates a new issue using the provided token and body object.
 *
 * @param  {string}   token    OAuth token provided by Github
 * @param  {object}   body     Issue body
 * @param  {Function} callback
 */
Github.prototype.postIssueWithToken = function(token, body, callback) {
  var _this = this;

  request({
    method: 'POST',
    uri: _this.host + _this.repo + '/issues',
    headers: {
      'User-Agent': 'build.webmaker.org',
      Accept: 'application/vnd.github.v3+json',
      Authorization: 'token ' + token
    },
    json: body
  }, function(err, res, body) {
    callback(err, body);
  });
};

var mofoWebmakerEngTeamId = "384003";
var foundationOrgs = ["MozillaFoundation", "MozillaScience"];

/**
 * Returns an array of milestones from the "plan" repo.
 *
 * @param  {string}   token    OAuth token provided by Github
 * @param  {Function} callback
 */
Github.prototype.getMilestones = function(callback) {
  this.githubJSON(this.repo + '/milestones', callback);
};

Github.prototype.getTeamIdsFromOrgs = function(orgs, callback) {
  async.concat(orgs, function(item, callback) {
    this.githubRequestAllPages({
      query: "orgs/" + item + "/teams"
    }, callback);
  }.bind(this), function(err, results) {
    var ids = [];
    if (err) {
      callback(err);
    } else {
      // Remove duplicates and filter out just a list of ids.
      results.forEach(function(team) {
        var id = team.id;
        if (ids.indexOf(id) === -1 && team.name !== "Owners") {
          ids.push(id);
        }
      });
      callback(err, ids);
    }
  });
};

Github.prototype.getReposFromTeamIds = function(teams, callback) {
  async.concat(teams, function(item, callback) {
    this.githubRequestAllPages({
      query: "teams/" + item + "/repos"
    }, callback);
  }.bind(this), function(err, results) {
    var repos = [];
    if (err) {
      callback(err);
    } else {
      results.forEach(function(repo) {
        var repoString = repo.owner.login + "/" + repo.name;
        // Remove duplicates and filter out just a list of ids.
        if (repos.indexOf(repoString) === -1) {
          repos.push(repoString);
        }
      });
      callback(err, repos);
    }
  });
};

Github.prototype.getReposFromOrgs = function(orgs, callback) {
  async.concat(orgs, function(item, callback) {
    this.githubRequestAllPages({
      query: "orgs/" + item + "/repos"
    }, callback);
  }.bind(this), function(err, results) {
    callback(err, results);
  });
};

Github.prototype.getMozillaRepos = function(callback) {
  this.getTeamIdsFromOrgs(foundationOrgs, function(err, ids) {
    if (err) {
      callback(err);
    } else {
      ids.push(mofoWebmakerEngTeamId);
      this.getReposFromTeamIds(ids, function(err, results) {
        callback(err, results);
      });
    }
  }.bind(this));
};
Github.prototype.getUsersForOrgs = function(orgs, callback) {
  async.concat(orgs, function(item, callback) {
    this.githubRequestAllPages({
      query: "orgs/" + item + "/members"
    }, callback);
  }.bind(this), function(err, results) {
    var users = [];
    if (err) {
      callback(err);
    } else {
      // don't bother returning duplicates.
      results.forEach(function(user) {
        if (users.indexOf(user.login) === -1) {
          users.push(user.login);
        }
      });
      callback(err, users);
    }
  });
};

Github.prototype.getFoundationUsers = function(callback) {
  this.getUsersForOrgs(foundationOrgs, function(err, results) {
    callback(err, results);
  });
};

Github.prototype.getMilestonesForRepos = function(repos, callback) {
  async.concat(repos, function(item, callback) {
    var orgName = item.repo;
    var repoName = item.org;
    this.githubRequestAllPages({
      query: "repos/" + item + "/milestones"
    }, callback);
  }.bind(this), function(err, results) {
    var collection = [];
    if (err) {
      callback(err);
    } else {
      // don't bother returning duplicates.
      results.forEach(function(item) {
        if (collection.indexOf(item.title) === -1) {
          collection.push(item.title);
        }
      });
      callback(err, collection);
    }
  });
};

Github.prototype.getLabelsForRepos = function(repos, callback) {
  async.concat(repos, function(item, callback) {
    var orgName = item.repo;
    var repoName = item.org;
    this.githubRequestAllPages({
      query: "repos/" + item + "/labels"
    }, callback);
  }.bind(this), function(err, results) {
    var collection = [];
    if (err) {
      callback(err);
    } else {
      // don't bother returning duplicates.
      results.forEach(function(item) {
        if (collection.indexOf(item.name) === -1) {
          collection.push(item.name);
        }
      });
      callback(err, collection);
    }
  });
};

Github.prototype.getIssuesForMilestone = function(id, callback) {
  this.githubJSON(this.repo + '/issues?milestone=' + id, callback);
};

Github.prototype.thisMilestone = function(callback) {
  var _this = this;

  _this.getMilestones(function(err, milestones) {
    if (err) return callback(err);

    var milestone = milestones[0];
    // Look for the first milestone that is in the future
    for (var i = 0; i < milestones.length; i++) {
      milestone = milestones[i];
      if (new Date(milestone.due_on) > new Date()) {
        break;
      }
    }
    if (typeof milestone === 'undefined') return callback('404');
    _this.getIssuesForMilestone(milestone.number, function(err, result) {
      if (err) return callback(err);

      return callback(null, _this.sortIssuesByPriority(result));
    });
  });
};

Github.prototype.nextMilestone = function(callback) {
  var _this = this;

  _this.getMilestones(function(err, milestones) {
    if (err) return callback(err);

    var milestone = milestones[0];
    // Look for the first milestone that is in the future
    for (var i = 0; i < milestones.length; i++) {
      milestone = milestones[i];
      if (new Date(milestone.due_on) > new Date()) {
        // look for the next one.
        milestone = milestones[Math.min(i+1, milestones.length-1)]
        break;
      }
    }
    if (typeof milestone === 'undefined') return callback('404');
    _this.getIssuesForMilestone(milestone.number, function(err, result) {
      if (err) return callback(err);

      return callback(null, _this.sortIssuesByPriority(result));
    });
  });
};

Github.prototype.upcomingMilestones = function(callback) {
  var _this = this;

  // Get milestones
  _this.getMilestones(function(err, milestones) {
    if (err) return callback(err);

    // Limit results and map issues
    var set = milestones.slice(0, 6);
    async.map(set, function(milestone, callback) {
      _this.getIssuesForMilestone(milestone.number, function(err, issues) {
        if (err) return callback(err);

        milestone.issues = issues;
        callback(null, milestone);
      });
    }, callback);
  });
};

Github.prototype.getUserInfo = function(username, callback) {
  var _this = this;

  // Cache target
  var url = "https://api.github.com/users/" + username;
  var copy = _this.cache.get(url);
  if (typeof copy !== 'undefined') {
    return callback(null, copy);
  }

  // Request from API
  request({
    method: 'GET',
    uri: url,
    headers: {
      'User-Agent': 'build.webmaker.org',
      Accept: 'application/vnd.github.v3+json',
      Authorization: 'token ' + _this.token
    },
    json: {}
  }, function(err, res, body) {
    if (err) return callback(err);

    // Set cache & return
    _this.cache.set(url, body);
    callback(err, body);
  });
};

Github.prototype.teamMembers = function(team, callback) {
  var _this = this;
  // Find the teams in the org
  // GET /orgs/:org/teams
  // find the id for team name "team"
  // get the members of the team
  // GET /teams/:id/members
  // For each member, get the user data (for names)
  this.githubJSON("/orgs/MozillaFoundation/teams", function(err, teamsblob) {
    // console.log(teamsblob);
    if (teamsblob) {
      teamsblob.forEach(function(teamblob) {
        console.log(teamblob.name.toLowerCase(), team.toLowerCase())
        if (teamblob.name.toLowerCase() == team.toLowerCase()) {
          var memberData = []
          // XXX this will break if we have > 100 people in a team.
          _this.githubJSON("/teams/"+teamblob.id+"/members?per_page=100", function(err, membersblob) {
            console.log("Got ", membersblob.length, "members" );
            async.map(membersblob, function(member, callback) {
              _this.githubJSON("/users/"+member.login, function(err, memberblob) {
                if (err) return callback(err);
                callback(null, memberblob);
              });
            }, callback);
          });
        }
      })
    }
    //callback('failure'); XXX
  });
};

// XXX REFACTOR THIS CACHING/TOKEN/JSON BUSINESS using githubJSON above


Github.prototype.myIssuesAssigned = function(callback) {
  this.githubJSON('/issues?filter=assigned&sort=updated&per_page=100', callback);
};

Github.prototype.myIssuesSubscribed = function(callback) {
  this.githubJSON('/issues?filter=subscribed&sort=updated&per_page=100', callback);
};

Github.prototype.myIssuesMentioned = function(callback) {
  this.githubJSON('/issues?filter=mentioned&sort=updated&per_page=100', callback);
};

Github.prototype.myIssuesCreated = function(callback) {
  this.githubJSON('/issues?filter=created&sort=updated&per_page=100', callback);
};

Github.prototype.search = function(q, sort, order, callback) {
  // Cache target
  var path = "?q="+encodeURIComponent(q) +
      "&sort="+encodeURIComponent(sort) +
      "&order="+encodeURIComponent(order);
  this.githubJSON("/search/issues/"+path, callback)
};
/**
 * Export
 */
module.exports = Github;
