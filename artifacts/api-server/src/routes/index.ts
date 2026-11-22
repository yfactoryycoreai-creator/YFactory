import { Router, type IRouter } from "express";
import healthRouter from "./health";
import imagesRouter from "./images";
import vaultRouter from "./vault";
import chatRouter from "./chat";
import conversationsRouter from "./conversations";
import providerCenterRouter from "./providerCenter";
import providerDiagnosticsRouter from "./providerDiagnostics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(imagesRouter);
router.use(vaultRouter);
router.use(chatRouter);
router.use(conversationsRouter);
router.use(providerCenterRouter);
router.use(providerDiagnosticsRouter);

export default router;
