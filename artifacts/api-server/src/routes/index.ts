import { Router, type IRouter } from "express";
import healthRouter from "./health";
import imagesRouter from "./images";
import vaultRouter from "./vault";
import chatRouter from "./chat";
import conversationsRouter from "./conversations";
import providerCenterRouter from "./providerCenter";
import providerDiagnosticsRouter from "./providerDiagnostics";
import videoRouter from "./video";
import ideCodeRouter from "./ideCode";
import agentTasksRouter from "./agentTasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(imagesRouter);
router.use(vaultRouter);
router.use(chatRouter);
router.use(conversationsRouter);
router.use(providerCenterRouter);
router.use(providerDiagnosticsRouter);
router.use(videoRouter);
router.use(ideCodeRouter);
router.use(agentTasksRouter);

export default router;
