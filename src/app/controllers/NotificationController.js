import Notification from '../schemas/Notification';
import User from '../models/User';

class NotificationController {
  async index(req, res) {
    const checkisProvider = await User.findOne({
      where: { id: req.userId, provider: true }
    });

    if (!checkisProvider) {
      return res
        .status(401)
        .json({ error: 'Only provider can load notifications' });
    }

    const notifications = await Notification.find({
      user: req.userId
    })
      .sort({ createdAt: 'desc' })
      .limit(20);

    return res.json(notifications);
  }

  async update(req, res) {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id },
      { read: true },
      { new: true }
    );
    res.json(notification);
  }
}
export default new NotificationController();
