var React = require("react");
var getJSON = require("./getJSON.jsx");

var AutoCompleteDataList = React.createClass({
  render: function() {
    return (
      <datalist id={this.props.id}>
        {this.props.data.map(function(item, index) {
          return (<option key={index} value={item}>{item}</option>);
        })}
      </datalist>
    );
  }
});

var Issues = React.createClass({
  getInitialState: function() {
    return {
      search: "assignee",
      term: "",
      query: [],
      users: [],
      repos: [],
      milestones: [],
      labels: []
    };
  },
  onSearchChange: function(e) {
    this.setState({
      search: e.target.value
    });
  },
  onSubmit: function(e) {
    e.preventDefault();
    var query = this.state.query;
    query.push({
      search: this.state.search,
      searchTerm: this.state.search + ":\"" + this.state.term + "\""
    });
    this.setState({
      query: query,
      term: ""
    });
  },
  onChange: function(event) {
    this.setState({
      term: event.target.value
    });
  },
  componentDidMount: function() {
    getJSON("/api/github/foundation-users", function(data) {
      this.setState({
        users: data
      });
    }.bind(this));

    getJSON("/api/github/mozilla-repo-names", function(data) {
      this.setState({
        repos: data
      });
    }.bind(this));

    getJSON("/api/github/mozilla-labels", function(data) {
      this.setState({
        labels: data
      });
    }.bind(this));

    getJSON("/api/github/mozilla-milestones", function(data) {
      this.setState({
        milestones: data
      });
    }.bind(this));
  },
  render: function() {
    var query = this.state.query;
    var term = this.state.term;
    var queryString = "";
    var needsOrgs = true;
    var defaultOrgs = "org:MozillaFoundation+org:mozilla+org:MozillaScience+";
    queryString += query.map(function(item) {
      if (item.search === "repo") {
        needsOrgs = false;
      }
      return item.searchTerm;
    }).join("+");
    if (needsOrgs) {
      queryString = defaultOrgs + queryString;
    }
    var link = "https://github.com/issues?utf8=✓&q=" + queryString;
    var doneButton;
    if (query.length) {
      doneButton = (<div className="clear-fix"><a href={link} className="pull-right button">Take me there</a></div>);
    }
    return (
      <div>
        <div className="header">
          <h2>Issues</h2>
        </div>
        <div className="main issues-page">
          <form onSubmit={this.onSubmit}>
            <select onChange={this.onSearchChange} className="search-types">
              <option value="assignee" selected>Assignee</option>
              <option value="author">Author</option>
              <option value="label">Label</option>
              <option value="milestone">Milestone</option>
              <option value="repo">Repo</option>
              <option value="mentions" selected>Mentions</option>
            </select>
            <span className="input-container">
              <input onChange={this.onChange} className="do-search-input" placeholder="search term" value={term} list={this.state.search}/>
            </span>
            <AutoCompleteDataList id="assignee" data={this.state.users}/>
            <AutoCompleteDataList id="author" data={this.state.users}/>
            <AutoCompleteDataList id="repo" data={this.state.repos}/>
            <AutoCompleteDataList id="milestone" data={this.state.milestones}/>
            <AutoCompleteDataList id="label" data={this.state.labels}/>
            <AutoCompleteDataList id="mentions" data={this.state.users}/>
            <div className="clear-fix"><button type="submit" className="pull-right button">add</button></div>
          </form>
          <ul>
          {query.map(function(item, index) {
            function onChange(e) {
              var value = e.target.value;
              var thisQuery = this.state.query;
              var split = value.split(":");
              var search = split[0] || "";

              thisQuery.splice(index, 1, {
                search: search,
                searchTerm: value
              });
              this.setState({
                query: thisQuery
              });  
            }
            function remove() {
              var thisQuery = this.state.query;
              thisQuery.splice(index, 1);
              this.setState({
                query: thisQuery
              });
            }
            var className = "query-item " + item.search + "-item";
            return (
              <li className={className}>
                <span className="close-button pull-right" onClick={remove.bind(this)}>x</span>
                <span className="input-container"> 
                  <input className="field-result" key={index} onChange={onChange.bind(this)} type="text" value={item.searchTerm}/>
                </span>
              </li>
            );
          }.bind(this))}
          </ul>
          {doneButton}
        </div>
      </div>
    );
  }
});

module.exports = Issues;
