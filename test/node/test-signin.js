/**
 * Created by ddavis on 11/14/15.
 */
'use strict';
var chai = require('chai');
/*global describe: true, it: true, before: false, after: false*/

var userEmail = process.env.MOCHA_TEST_USER;
var password = process.env.MOCHA_TEST_CREDENTIALS;

describe('Test build of services using Xtivia\'s Liferay Demo server',function() {
    describe('Test signin functionality',function() {
        it('should pass if server is available and user information is correct',function() {
            this.timeout(15000); // Just in case slow access to server
            return require('../../index.js')({server:'http://liferaydemo.xtivia.com'}).then(function(connection){
                chai.assert.isNotNull(connection);
                return connection.signin({
                    authenticationType: connection.AuthenticationType.BASIC,
                    username: userEmail,
                    credentials: password
                }).then(function(ctx) {
                    chai.assert.isNotNull(ctx);
                    console.log(ctx);
                },function(err) {
                    throw err;
                });
            },function(err) {
                throw err;
            });
        });
    });
});