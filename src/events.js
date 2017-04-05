// Utility functions to work with Watson Work Webhook events

import * as messages from './messages';
import * as users from './users';
import * as util from 'util';
import debug from 'debug';

// Setup debug log
const log = debug('watsonwork-weather-events');

// Return the first action identified in a message-focus annotation event
export const onActionIdentified = (evt, appId, token, cb) => {
  // Check for a message-focus annotation
  if(evt.type === 'message-annotation-added' &&
    evt.annotationType === 'message-focus') {

    // Pick the first action found on the message-focus annotation
    const focus = JSON.parse(evt.annotationPayload);
    if(focus.applicationId === appId) {
      const action = focus.actions && focus.actions[0];
      if(action) {
        log('Idenfified action %s', action);

        // Retrieve the original message annotated with the message-focus
        // annotation
        messages.message(evt.messageId,
          token(), (err, message) => {
            if(err)
              return;
            // Ignore messages from the app itself
            if(message.createdBy.id === appId)
              return;

            log('Focus message %s',
              util.inspect(message, { colors: debug.useColors(), depth: 10 }));

            // Return the identified action, the message for which the action
            // was identified, its focus annotation, and the user who sent
            // that message
            cb(action, message, focus, message.createdBy);
          });
      }
    }
  }
};

// Return the action selected in an action-selected annotation event
export const onActionSelected = (evt, appId, token, cb) => {
  // Check for an action-selected annotation
  if(evt.type === 'message-annotation-added' &&
    evt.annotationType === 'actionSelected') {

    // Look for the selected action on the annotation
    const selection = JSON.parse(evt.annotationPayload);
    if(selection.targetUserId === appId) {
      const action = selection.actionId;
      if(action) {
        log('Selected action %s', action);

        // Retrieve the user who selected the action
        users.user(evt.userId,
          token(), (err, user) => {
            if(err)
              return;
            log('Action selected by user %o', user);

            // Retrieve the original message that led to the action being
            // identified, as it contains information relevant to the
            // action, in particular any recognized entities
            messages.message(selection.referralMessageId,
              token(), (err, fmessage) => {
                if(err)
                  return;
                // Ignore messages from the app itself
                if(fmessage.createdBy.id === appId)
                  return;

                log('Focus message %s', util.inspect(fmessage,
                  { colors: debug.useColors(), depth: 10 }));

                // Find the original message-focus annotation on that
                // message
                const focus = fmessage.annotations.filter((a) =>
                  a.type === 'message-focus' &&
                  a.applicationId === appId)[0];

                // Return the selected action, the message for which the
                // action was identified, its focus annotation, the
                // action selection annotation, and the user who selected
                // the action
                cb(action, fmessage, focus, selection, user);
              });
          });
      }
    }
  }
};

