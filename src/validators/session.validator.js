import Joi from "joi";
import { objectId, cleanText } from "./custom.js";

export const startSessionSchema = Joi.object({
  plannedDuration: Joi.number()
    .min(0)
    .max(24 * 3600),
  started_at: Joi.date(),
  timer_type: Joi.string(),
  session_type: Joi.string(),
  tag_id: Joi.string().allow(null).optional(),
});

export const updateSessionSchema = Joi.object({
  session_id: objectId.optional(),
  duration: Joi.number().min(0),
  completed: Joi.boolean(),
  ended_at: Joi.date(),
}).min(1);

export const timeRangeQuerySchema = Joi.object({
  startTime: Joi.date().required(),
  endTime: Joi.date().greater(Joi.ref("startTime")).required(),
  userId: objectId.optional(),
  user_id: objectId.optional(),
});

export const changeNoteSchema = Joi.object({
  notes: Joi.string().max(500).custom(cleanText).required(),
});
export const changeTagSchema = Joi.object({
  tag_id: Joi.string().allow("").optional(),
});
