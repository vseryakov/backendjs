//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

// This is a skeleton module to be extended by the specific shell implementation,
// it must inject at least a function `run` which will be called upon startup

const shell = {
};

module.exports = shell;

shell.run = function(options)
{
    console.log("empty shell implementation loaded");
}
